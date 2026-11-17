import "server-only";

import { db } from "@/prisma/db";
import { convertUsdCentsToIdr, getUsdToIdrRate } from "@/lib/fx";
import { dialDigits } from "@/lib/flag";
import { recomputeUserPoints } from "@/lib/loyalty";
import {
  createPaymentSession,
  createCardPaymentToken,
  createTokenPayment,
  failureUrl,
  getCardSession,
  getPaymentRequest,
  getPaymentToken,
  mapGatewayStatus,
  redirectActionUrl,
  successUrl,
  SESSION_TTL_MS,
  type GatewayPayment,
  type PaymentChannel,
} from "@/lib/xendit";
import { decryptSecret } from "@/lib/crypto";
import { loadInvoice, type InvoiceDTO } from "@/lib/invoice";
import {
  captureOrder,
  createOrder,
  extractCapture,
  failureUrl as paypalFailureUrl,
  getOrder,
  successUrl as paypalSuccessUrl,
  type PayPalGatewayPayment,
} from "@/lib/paypal";
import { sendBookingConfirmation } from "@/lib/notify";
import { notifyEvoaStatusChange } from "@/lib/evoa-notify";
import { notifyAdminOrderPaid } from "@/lib/order-notifications";
import { syncOrderToGoogleCalendar } from "@/lib/google-calendar";

/**
 * The payment service.
 *
 * It owns the lifecycle of a payment row: it creates the gateway payment,
 * stores the provider references on the row, and applies the state transition
 * when the gateway tells us the money arrived.
 *
 * The gateways are Xendit (Payments API v3): Credit Card via a PAYMENT_LINK
 * Payment Session — the customer pays on
 * Xendit's hosted checkout page; and PayPal (Orders v2, USD-native, MANUAL
 * capture): the customer approves the order on PayPal, then the server
 * captures it — both the return page and the webhook capture after
 * approval. Credentials live in the environment only.
 *
 * Prices are stored and displayed in USD. Xendit charges in IDR, so the
 * booking total (USD cents) is converted to whole rupiah with the live
 * USD→IDR rate at session creation; the rate and the IDR amount are frozen
 * on the payment row (`fxRate`, `providerAmountCents`, `providerCurrency`).
 * PayPal charges USD as-is — no FX conversion happens there and `fxRate`
 * stays 1.
 *
 * The rules that matter:
 *
 *   - the amount is always the one the server computed for the booking,
 *     never one that came from the browser;
 *   - a webhook only confirms the booking when the amount matches;
 *   - a replayed webhook changes nothing (the event id is unique).
 */

/**
 * The Xendit channels a PaymentMethod can be bound to — card and QRIS.
 * Virtual Account is retired (its inactive PaymentMethod row remains for
 * historical payments, and the webhook still settles any legacy event).
 */
const SUPPORTED_CHANNELS: readonly PaymentChannel[] = [
  "CREDIT_CARD",
  "QRIS",
];

export type PaymentMethodDTO = {
  id: string;
  code: string;
  label: string;
  provider: string | null;
  providerMethodCode: string | null;
};

/** The payment methods that can be started, with their gateway binding. */
export async function listPaymentMethods(): Promise<PaymentMethodDTO[]> {
  const rows = await db.orm.public.PaymentMethod
    .select("id", "code", "label", "provider", "providerMethodCode")
    .where((f) => f.active.eq(true))
    .orderBy((f) => f.sortOrder.asc())
    .all();

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    provider: row.provider ?? null,
    providerMethodCode: row.providerMethodCode ?? null,
  }));
}

/** The payment of a booking — the most recent one. */
export async function getBookingPayment(bookingId: string) {
  const rows = await db.orm.public.Payment
    .select(
      "id",
      "bookingId",
      "methodId",
      "status",
      "amountUsdCents",
      "provider",
      "providerRef",
      "providerAmountCents",
      "checkoutUrl",
      "expiresAt",
      "paidAt",
      "rawPayload",
    )
    .where((f) => f.bookingId.eq(bookingId))
    .orderBy((f) => f.createdAt.desc())
    .limit(1)
    .all();

  return rows[0] ?? null;
}

/**
 * The Xendit session reference for an attempt.
 *
 * The booking invoice (`#INV/YYYY/MM/DD/NNNN/XX`, 24 chars) is used as-is on
 * the first attempt; retries get a `-R<n>` suffix so a failed or expired
 * transaction never collides with the new one. Xendit caps `reference_id`
 * at 64 characters.
 */
function invoiceForAttempt(base: string, attempt: number): string {
  if (attempt <= 1) return base.slice(0, 64);
  return `${base}-R${attempt}`.slice(0, 64);
}

/** Build an E.164 phone number from the contact's country code + number. */
function e164Phone(countryCode: string, phone: string): string | undefined {
  const cc = dialDigits(countryCode);
  let p = phone.replace(/\D/g, "");
  if (!cc || !p) return undefined;
  if (p.startsWith("0")) p = p.slice(1);
  const full = `+${cc}${p}`;
  return full.length >= 9 && full.length <= 16 ? full : undefined;
}

/** The successful start-payment payload shared by every return path. */
type StartPaymentOk = {
  ok: true;
  checkoutUrl: string;
  paymentId: string;
};

/** The pending payment-row data both gateways write in startPayment. */
type PendingGatewayRowData = {
  methodId: string;
  status: string;
  amountUsdCents: number;
  reference: string;
  provider: string;
  providerRef: string;
  providerAmountCents: number;
  providerCurrency: string;
  fxRate: number;
  checkoutUrl: string | null;
  expiresAt: Date | null;
  rawPayload: never;
};

/**
 * Write the pending gateway payment row and return its id.
 *
 * The booking was created with a placeholder payment row — it is filled
 * with the gateway data instead of a second row being added. A retry after
 * a failed or expired attempt still gets a fresh row.
 */
async function writePendingGatewayRow(
  bookingId: string,
  existing: {
    id: string;
    status: string;
    provider: string | null;
    providerRef: string | null;
  } | null,
  gatewayData: PendingGatewayRowData,
): Promise<string> {
  if (
    existing &&
    existing.status === "pending" &&
    !existing.provider &&
    !existing.providerRef
  ) {
    await db.orm.public.Payment
      .where((f) => f.id.eq(existing.id))
      .update(gatewayData);
    return existing.id;
  }

  const paymentId = crypto.randomUUID();
  await db.orm.public.Payment.create({
    id: paymentId,
    bookingId,
    ...gatewayData,
  });
  return paymentId;
}

/**
 * Start a payment for a booking.
 *
 * The booking is looked up by its code and the caller has to prove the
 * ownership with the contact email — the same rule the booking lookup uses.
 */
export async function startPayment(params: {
  bookingCode: string;
  email: string;
  methodCode: string;
}): Promise<StartPaymentOk | { ok: false; error: string }> {
  const code = params.bookingCode.trim().toUpperCase();
  const email = params.email.trim().toLowerCase();

  const bookings = await db.orm.public.Booking
    .select("id", "code", "status", "totalUsdCents", "invoiceNumber")
    .where((f) => f.code.eq(code))
    .limit(1)
    .all();

  const booking = bookings[0];
  if (!booking) return { ok: false, error: "Pesanan tidak ditemukan." };

  const contacts = await db.orm.public.Contact
    .select("email", "firstName", "lastName", "phoneCountryCode", "phone")
    .where((f) => f.bookingId.eq(booking.id))
    .limit(1)
    .all();

  if (!contacts[0] || contacts[0].email.trim().toLowerCase() !== email) {
    return { ok: false, error: "Pesanan tidak ditemukan." };
  }

  if (booking.status === "confirmed" || booking.status === "completed") {
    return { ok: false, error: "Pesanan ini sudah dibayar." };
  }

  const methods = await listPaymentMethods();
  const method = methods.find((m) => m.code === params.methodCode);
  if (!method) return { ok: false, error: "Metode pembayaran tidak tersedia." };

  // The second gateway is PayPal — anything that is neither Xendit nor
  // PayPal is unsupported.
  const isPayPal = method.provider === "paypal";
  if (!isPayPal && method.provider !== "xendit") {
    return { ok: false, error: "Metode pembayaran ini belum didukung." };
  }

  const providerMethodCode = (method.providerMethodCode ?? "").toUpperCase();
  if (isPayPal) {
    if (providerMethodCode !== "PAYPAL") {
      return { ok: false, error: "Metode pembayaran ini belum didukung." };
    }
  } else if (!SUPPORTED_CHANNELS.includes(providerMethodCode as PaymentChannel)) {
    return { ok: false, error: "Metode pembayaran ini belum didukung." };
  }

  // Re-use an open payment instead of creating a second one — as long as
  // it is the SAME gateway + method and the hosted page has not expired.
  // Switching the method (e.g. card → PayPal) starts a fresh attempt instead.
  const existing = await getBookingPayment(booking.id);
  if (
    existing &&
    existing.status === "pending" &&
    existing.provider === method.provider &&
    existing.methodId === method.id &&
    existing.providerRef &&
    existing.checkoutUrl &&
    (!existing.expiresAt || existing.expiresAt.getTime() > Date.now())
  ) {
    return {
      ok: true,
      checkoutUrl: existing.checkoutUrl,
      paymentId: existing.id,
    };
  }

  const contact = contacts[0];

  if (isPayPal) {
    // PayPal is USD-native — the booking total is charged as-is, no FX
    // conversion happens and `fxRate` stays 1.
    const amountUsdCents = booking.totalUsdCents;

    // Count the previous attempts so a retry gets a fresh reference.
    const previous = await db.orm.public.Payment
      .select("id")
      .where((f) => f.bookingId.eq(booking.id))
      .where((f) => f.provider.eq("paypal"))
      .all();
    const invoiceNumber = invoiceForAttempt(
      booking.invoiceNumber ?? `INV-${booking.code}`,
      previous.length + 1,
    );

    const payment: PayPalGatewayPayment = await createOrder({
      invoiceId: invoiceNumber,
      customId: booking.id,
      description: `Booking VIP ${booking.code}`,
      amountUsdCents,
      payerEmail: email,
      payerFirstName: contact.firstName,
      payerLastName: contact.lastName,
      returnUrl: paypalSuccessUrl(booking.code),
      cancelUrl: paypalFailureUrl(booking.code),
    });

    const gatewayData = {
      methodId: method.id,
      status: "pending",
      amountUsdCents,
      reference: invoiceNumber,
      provider: "paypal",
      providerRef: payment.providerRef,
      providerAmountCents: payment.amountCents,
      providerCurrency: "USD",
      fxRate: 1,
      checkoutUrl: payment.checkoutUrl ?? null,
      expiresAt: payment.expiresAt ?? null,
      rawPayload: payment.raw as never,
    };

    const paymentId = await writePendingGatewayRow(
      booking.id,
      existing,
      gatewayData,
    );

    if (!payment.checkoutUrl) {
      return { ok: false, error: "Gateway tidak mengembalikan link pembayaran." };
    }

    return {
      ok: true,
      checkoutUrl: payment.checkoutUrl,
      paymentId,
    };
  }

  const channel = providerMethodCode as PaymentChannel;

  // Xendit charges in IDR — convert the USD total with the rate of the
  // moment the session is created. The rate is frozen on the payment row.
  const amountUsdCents = booking.totalUsdCents;
  const rate = await getUsdToIdrRate();
  const amountIdr = convertUsdCentsToIdr(amountUsdCents, rate);

  // Count the previous attempts so a retry gets a fresh reference.
  const previous = await db.orm.public.Payment
    .select("id")
    .where((f) => f.bookingId.eq(booking.id))
    .where((f) => f.provider.eq("xendit"))
    .all();
  const invoiceNumber = invoiceForAttempt(
    booking.invoiceNumber ?? `INV-${booking.code}`,
    previous.length + 1,
  );

  const payment: GatewayPayment = await createPaymentSession({
    channel,
    referenceId: invoiceNumber,
    amountIdr,
    payerEmail: email,
    payerFirstName: contact.firstName,
    payerLastName: contact.lastName,
    payerPhone: e164Phone(contact.phoneCountryCode ?? "", contact.phone ?? ""),
    customerReferenceId: booking.id,
    description: `Booking VIP ${booking.code}`,
    successRedirectUrl: successUrl(booking.code),
    failureRedirectUrl: failureUrl(booking.code),
  });

  const gatewayData = {
    methodId: method.id,
    status: "pending",
    amountUsdCents,
    reference: invoiceNumber,
    provider: "xendit",
    providerRef: payment.providerRef,
    providerAmountCents: payment.amountCents,
    providerCurrency: payment.currency,
    fxRate: rate,
    checkoutUrl: payment.checkoutUrl ?? null,
    expiresAt: payment.expiresAt ?? null,
    rawPayload: payment.raw as never,
  };

  const paymentId = await writePendingGatewayRow(
    booking.id,
    existing,
    gatewayData,
  );

  if (!payment.checkoutUrl) {
    return { ok: false, error: "Gateway tidak mengembalikan link pembayaran." };
  }

  return {
    ok: true,
    checkoutUrl: payment.checkoutUrl,
    paymentId,
  };
}

/**
 * Charge one of the customer's saved cards — the CVV-only path.
 *
 * The PAN rests encrypted on the `SavedCard` row; the CVV arrives with this
 * call and lives in memory only. The server tokenizes the pair at Xendit
 * (`POST /v3/payment_tokens`) and charges the token with a PAY payment
 * request. Two answers need a browser step:
 *
 *   - the tokenization answers REQUIRES_ACTION (3DS) — the payment row is
 *     stored with the token id as provider reference and the 3DS URL as
 *     checkout URL; the waiting page polls `refreshPayment`, which finishes
 *     the charge once the token turns ACTIVE;
 *   - the charge itself answers REQUIRES_ACTION — same shape, the provider
 *     reference is then the payment request id.
 *
 * A synchronous SUCCEEDED charge confirms the booking right here.
 */
export type SavedCardPaymentResult =
  | { ok: true; status: "paid"; paymentId: string }
  | { ok: true; status: "requires_action"; redirectUrl: string; paymentId: string }
  | { ok: true; status: "pending"; paymentId: string }
  | { ok: false; error: string };

export async function startSavedCardPayment(params: {
  bookingCode: string;
  email: string;
  cardId: string;
  cvv: string;
}): Promise<SavedCardPaymentResult> {
  const code = params.bookingCode.trim().toUpperCase();
  const email = params.email.trim().toLowerCase();
  const cvv = params.cvv.trim();

  if (!/^\d{3,4}$/.test(cvv)) {
    return { ok: false, error: "CVV tidak valid." };
  }

  const bookings = await db.orm.public.Booking
    .select("id", "code", "status", "totalUsdCents", "invoiceNumber")
    .where((f) => f.code.eq(code))
    .limit(1)
    .all();
  const booking = bookings[0];
  if (!booking) return { ok: false, error: "Pesanan tidak ditemukan." };

  const contacts = await db.orm.public.Contact
    .select("email", "firstName", "lastName", "phoneCountryCode", "phone")
    .where((f) => f.bookingId.eq(booking.id))
    .limit(1)
    .all();
  const contact = contacts[0];
  if (!contact || contact.email.trim().toLowerCase() !== email) {
    return { ok: false, error: "Pesanan tidak ditemukan." };
  }

  if (booking.status === "confirmed" || booking.status === "completed") {
    return { ok: false, error: "Pesanan ini sudah dibayar." };
  }

  const cards = await db.orm.public.SavedCard
    .select("id", "brand", "last4", "encryptedNumber", "expMonth", "expYear", "holderName")
    .where((f) => f.id.eq(params.cardId))
    .limit(1)
    .all();
  const card = cards[0];
  if (!card) return { ok: false, error: "Kartu tidak ditemukan." };

  const pan = decryptSecret(card.encryptedNumber);
  if (!pan) return { ok: false, error: "Kartu tidak bisa dibaca. Simpan ulang kartunya." };

  // The card method row the payment is booked against (CREDIT_CARD).
  const methods = await listPaymentMethods();
  const method =
    methods.find((m) => m.providerMethodCode === "CREDIT_CARD") ??
    methods.find((m) => m.code === "CREDIT_CARD");
  if (!method) return { ok: false, error: "Metode pembayaran tidak tersedia." };

  const existing = await getBookingPayment(booking.id);

  const amountUsdCents = booking.totalUsdCents;
  const rate = await getUsdToIdrRate();
  const amountIdr = convertUsdCentsToIdr(amountUsdCents, rate);

  const previous = await db.orm.public.Payment
    .select("id")
    .where((f) => f.bookingId.eq(booking.id))
    .where((f) => f.provider.eq("xendit"))
    .all();
  const invoiceNumber = invoiceForAttempt(
    booking.invoiceNumber ?? `INV-${booking.code}`,
    previous.length + 1,
  );

  const returnSuccess = successUrl(booking.code);
  const returnFailure = failureUrl(booking.code);
  const phone = e164Phone(contact.phoneCountryCode ?? "", contact.phone ?? "");

  let token;
  try {
    token = await createCardPaymentToken({
      referenceId: `${invoiceNumber}-T`,
      cardNumber: pan,
      cvv,
      expMonth: card.expMonth,
      expYear: card.expYear,
      payerEmail: email,
      payerFirstName: contact.firstName,
      payerLastName: contact.lastName,
      payerPhone: phone,
      customerReferenceId: booking.id,
      successReturnUrl: returnSuccess,
      failureReturnUrl: returnFailure,
    });
  } catch (error) {
    console.error("[payments] saved-card tokenization failed", error);
    return { ok: false, error: messageOf(error, "Tokenisasi kartu ditolak gateway.") };
  }

  const tokenId = token.payment_token_id;
  if (!tokenId) {
    return { ok: false, error: "Gateway tidak mengembalikan token kartu." };
  }

  const savedCardMeta = {
    savedCard: { cardId: card.id, brand: card.brand, last4: card.last4 },
  };

  // 3DS on the tokenization — store the open attempt and let the waiting
  // page finish the charge once the customer authenticated.
  if ((token.status ?? "").toUpperCase() === "REQUIRES_ACTION") {
    const redirectUrl = redirectActionUrl(token.actions);
    if (!redirectUrl) {
      return { ok: false, error: "Gateway meminta autentikasi tanpa tautan." };
    }
    const paymentId = await writePendingGatewayRow(booking.id, existing, {
      methodId: method.id,
      status: "pending",
      amountUsdCents,
      reference: invoiceNumber,
      provider: "xendit",
      providerRef: tokenId,
      providerAmountCents: Math.round(amountIdr * 100),
      providerCurrency: "IDR",
      fxRate: rate,
      checkoutUrl: redirectUrl,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      rawPayload: { ...savedCardMeta, stage: "token", token: token } as never,
    });
    return { ok: true, status: "requires_action", redirectUrl, paymentId };
  }

  if ((token.status ?? "").toUpperCase() === "FAILED") {
    return { ok: false, error: "Kartu ditolak gateway. Periksa kembali datanya." };
  }

  return chargeWithToken({
    booking,
    contact,
    existing,
    methodId: method.id,
    tokenId,
    invoiceNumber,
    amountUsdCents,
    amountIdr,
    rate,
    savedCardMeta,
  });
}

/** The shared tail of the saved-card flow: charge a READY token. */
async function chargeWithToken(params: {
  booking: { id: string; code: string; totalUsdCents: number };
  contact: { firstName: string; lastName: string };
  existing: {
    id: string;
    status: string;
    provider: string | null;
    providerRef: string | null;
  } | null;
  methodId: string;
  tokenId: string;
  invoiceNumber: string;
  amountUsdCents: number;
  amountIdr: number;
  rate: number;
  savedCardMeta: { savedCard: { cardId: string; brand: string; last4: string } };
}): Promise<SavedCardPaymentResult> {
  const {
    booking,
    existing,
    methodId,
    tokenId,
    invoiceNumber,
    amountUsdCents,
    amountIdr,
    rate,
    savedCardMeta,
  } = params;

  let request;
  try {
    request = await createTokenPayment({
      referenceId: invoiceNumber,
      paymentTokenId: tokenId,
      amountIdr,
      description: `Booking VIP ${booking.code}`,
      successReturnUrl: successUrl(booking.code),
      failureReturnUrl: failureUrl(booking.code),
    });
  } catch (error) {
    console.error("[payments] saved-card charge failed", error);
    return { ok: false, error: messageOf(error, "Charge kartu ditolak gateway.") };
  }

  const requestId = request.payment_request_id;
  if (!requestId) {
    return { ok: false, error: "Gateway tidak mengembalikan payment request." };
  }

  const status = mapGatewayStatus(request.status);

  const paymentId = await writePendingGatewayRow(booking.id, existing, {
    methodId,
    status: "pending",
    amountUsdCents,
    reference: invoiceNumber,
    provider: "xendit",
    providerRef: requestId,
    providerAmountCents: Math.round(amountIdr * 100),
    providerCurrency: "IDR",
    fxRate: rate,
    checkoutUrl: redirectActionUrl(request.actions),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    rawPayload: { ...savedCardMeta, stage: "charge", request } as never,
  });

  if (status === "paid") {
    await confirmPaidPayment(paymentId, booking.id, {
      ...savedCardMeta,
      request,
    });
    return { ok: true, status: "paid", paymentId };
  }

  if (status === "failed") {
    await db.orm.public.Payment
      .where((f) => f.id.eq(paymentId))
      .update({ status: "failed", rawPayload: { ...savedCardMeta, request } as never });
    return { ok: false, error: "Pembayaran ditolak. Coba kartu atau metode lain." };
  }

  const redirectUrl = redirectActionUrl(request.actions);
  if (status === "requires_action" && redirectUrl) {
    return { ok: true, status: "requires_action", redirectUrl, paymentId };
  }

  return { ok: true, status: "pending", paymentId };
}

/** A gateway error message safe to show, with a local fallback. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    // Xendit error bodies carry a human message — surface it verbatim.
    return error.message.slice(0, 200);
  }
  return fallback;
}

/**
 * Apply a gateway callback.
 *
 * The event id is written first — a replay hits the unique constraint and
 * stops here, so a duplicated webhook is a no-op.
 */
export async function applyGatewayEvent(params: {
  provider: string;
  eventId: string;
  eventType: string;
  providerRef?: string;
  externalId?: string;
  status: string;
  amountCents?: number;
  currency?: string;
  raw: unknown;
}): Promise<{ outcome: "processed" | "ignored" | "failed"; error?: string }> {
  const event = await db.orm.public.PaymentWebhookEvent
    .select("id")
    .where((f) => f.provider.eq(params.provider))
    .where((f) => f.providerEventId.eq(params.eventId))
    .limit(1)
    .all();

  if (event.length > 0) {
    return { outcome: "ignored" };
  }

  // Find the payment by the provider reference — for Xendit that is the
  // payment session id. Payment-level events carry the payment request id
  // instead; they fall back to our own invoice reference.
  let payments = await db.orm.public.Payment
    .select("id", "bookingId", "status", "amountUsdCents", "providerAmountCents")
    .where((f) => f.provider.eq(params.provider))
    .where((f) => f.providerRef.eq(params.providerRef ?? ""))
    .limit(1)
    .all();

  if (payments.length === 0) {
    const externalId = params.externalId;
    if (externalId) {
      payments = await db.orm.public.Payment
        .select("id", "bookingId", "status", "amountUsdCents", "providerAmountCents")
        .where((f) => f.provider.eq(params.provider))
        .where((f) => f.reference.eq(externalId))
        .limit(1)
        .all();
    }
  }

  const payment = payments[0];
  const target = payment ? "processed" : "ignored";

  await db.orm.public.PaymentWebhookEvent.create({
    id: crypto.randomUUID(),
    provider: params.provider,
    providerEventId: params.eventId,
    eventType: params.eventType,
    outcome: target,
    payload: params.raw as never,
  });

  if (!payment) {
    return { outcome: "ignored" };
  }

  // Every event family maps through the same table: session events
  // (COMPLETED / EXPIRED), payment events (SUCCEEDED / FAILED) and the
  // channel-level QRIS / VA events (qr.payment / va.payment — PAID /
  // COMPLETED / EXPIRED / FAILED).
  const status = mapGatewayStatus(params.status);

  // A paid event only counts when the amount matches what we charged.
  if (status === "paid") {
    const expected = payment.providerAmountCents;
    const received = params.amountCents;

    if (
      typeof received === "number" &&
      typeof expected === "number" &&
      received !== expected
    ) {
      await db.orm.public.PaymentWebhookEvent
        .where((f) => f.provider.eq(params.provider))
        .where((f) => f.providerEventId.eq(params.eventId))
        .update({ outcome: "failed" });

      console.error(
        "[payments] amount mismatch — the booking was not confirmed",
        { expected, received },
      );
      return { outcome: "failed", error: "Amount mismatch." };
    }

    await confirmPaidPayment(payment.id, payment.bookingId, params.raw);
  } else if (status === "failed" || status === "expired" || status === "cancelled") {
    await db.orm.public.Payment
      .where((f) => f.id.eq(payment.id))
      .update({
        status: status === "failed" ? "failed" : "pending",
        rawPayload: params.raw as never,
      });
  }

  return { outcome: "processed" };
}

/**
 * Mark a payment paid and confirm its booking — idempotent, so the webhook
 * and the status refresh can both call it safely.
 */
async function confirmPaidPayment(
  paymentId: string,
  bookingId: string,
  raw?: unknown,
): Promise<void> {
  // Was this attempt already paid? The confirmation writes stay idempotent
  // either way, but the customer notification fires only on the first one.
  const priorRows = await db.orm.public.Payment
    .select("status", "rawPayload")
    .where((f) => f.id.eq(paymentId))
    .limit(1)
    .all();
  const alreadyPaid = priorRows[0]?.status === "paid";

  // Saved-card attempts carry the masked card meta in `rawPayload` so the
  // success page can show "ending in 1234" — a webhook confirmation must
  // not wipe it, so the meta survives every raw payload overwrite.
  const priorRaw = priorRows[0]?.rawPayload as Record<string, unknown> | null;
  const savedCardMeta =
    priorRaw && typeof priorRaw === "object" ? priorRaw.savedCard : undefined;
  const mergedRaw =
    raw !== undefined && savedCardMeta !== undefined
      ? { ...(raw as Record<string, unknown>), savedCard: savedCardMeta }
      : raw;

  await db.orm.public.Payment
    .where((f) => f.id.eq(paymentId))
    .update({
      status: "paid",
      paidAt: new Date(),
      ...(mergedRaw !== undefined ? { rawPayload: mergedRaw as never } : {}),
    });

  await db.orm.public.Booking
    .where((f) => f.id.eq(bookingId))
    .update({ status: "confirmed" });

  await awardPointsForBooking(bookingId);

  // e-VOA orders reuse this booking payment pipeline. Both the webhook and the
  // return-page status refresh converge on confirmPaidPayment, so syncing the
  // visa order here covers both paths with a single hook. It must never break
  // the booking confirmation — any failure is logged and swallowed.
  try {
    const applications = await db.orm.public.VisaApplication
      .select("id", "status")
      .where((f) => f.bookingId.eq(bookingId))
      .limit(1)
      .all();
    const application = applications[0];
    if (application && application.status === "awaiting_payment") {
      await db.orm.public.VisaApplication
        .where((f) => f.id.eq(application.id))
        .update({ status: "paid", paidAt: new Date() });
      await db.orm.public.EvoaStatusEvent.create({
        id: crypto.randomUUID(),
        applicationId: application.id,
        status: "paid",
        actor: "system",
        note: "Pembayaran diterima via Xendit.",
      });
      // Fire-and-forget — the notifier swallows its own errors.
      void notifyEvoaStatusChange(application.id, "paid");
    }
  } catch (error) {
    console.error("[payments] e-VOA status sync failed", error);
  }

  // The customer confirmation (WhatsApp when configured) — fire-and-forget.
  // Only on the first paid transition, and it can never block or fail the
  // confirmation: every error is logged inside the notifier.
  if (!alreadyPaid) {
    void notifyBookingConfirmed(bookingId).catch((error) => {
      console.error("[payments] confirmation notification failed", error);
    });
    void notifyAdminOrderPaid(bookingId).catch((error) => {
      console.error("[payments] admin order notification failed", error);
    });
    // Google Calendar event for the service time — fires for every product
    // (bookings and e-VOA alike, since both flow through this pipeline) on
    // the first paid transition only, so no duplicate events. The sync
    // swallows its own errors and can never affect the confirmation.
    void syncOrderToGoogleCalendar(bookingId).catch((error) => {
      console.error("[payments] google calendar sync failed", error);
    });
  }
}

/**
 * Assemble the booking summary and hand it to the notifier.
 *
 * Reads only what the message needs; any failure here is logged and
 * swallowed — the booking is already confirmed at this point.
 */
async function notifyBookingConfirmed(bookingId: string): Promise<void> {
  try {
    const bookings = await db.orm.public.Booking
      .select(
        "code",
        "serviceAt",
        "adultCount",
        "childCount",
        "infantCount",
        "totalUsdCents",
        "invoiceNumber",
        "hotelName",
        "pickupLabel",
        "departureId",
      )
      .where((f) => f.id.eq(bookingId))
      .limit(1)
      .all();
    const booking = bookings[0];
    if (!booking) return;

    const contacts = await db.orm.public.Contact
      .select("firstName", "lastName", "phoneCountryCode", "phone")
      .where((f) => f.bookingId.eq(bookingId))
      .limit(1)
      .all();
    const contact = contacts[0];

    const items = await db.orm.public.BookingItem
      .select("label", "packageLabel")
      .where((f) => f.bookingId.eq(bookingId))
      .limit(1)
      .all();
    const item = items[0];

    let departureStartTime: string | null = null;
    if (booking.departureId) {
      try {
        const departures = await db.orm.public.TourDeparture
          .select("startTime")
          .where((f) => f.id.eq(booking.departureId!))
          .limit(1)
          .all();
        departureStartTime = departures[0]?.startTime ?? null;
      } catch {
        // Unmigrated DB — the message simply omits the departure time.
      }
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    await sendBookingConfirmation({
      code: booking.code,
      tourTitle: item?.label ?? "Pesanan Booking VIP",
      packageLabel: item?.packageLabel ?? null,
      serviceAt: new Date(booking.serviceAt).toISOString(),
      departureStartTime,
      adultCount: booking.adultCount,
      childCount: booking.childCount,
      infantCount: booking.infantCount,
      hotelName: booking.hotelName ?? null,
      pickupLabel: booking.pickupLabel ?? null,
      totalUsdCents: booking.totalUsdCents,
      invoiceNumber: booking.invoiceNumber ?? null,
      contactName: contact
        ? `${contact.firstName} ${contact.lastName}`.trim()
        : "",
      contactPhone: contact
        ? e164Phone(contact.phoneCountryCode ?? "", contact.phone ?? "") ?? null
        : null,
      voucherUrl: `${appUrl}/voucher/${encodeURIComponent(booking.code)}`,
    });
  } catch (error) {
    console.error("[payments] could not assemble the confirmation notification", error);
  }
}

/** The status of a booking's payment — used by the return page. */
export async function getPaymentStatus(params: {
  bookingCode: string;
  email: string;
}): Promise<
  | {
      ok: true;
      status: string;
      bookingStatus: string;
      amountUsdCents: number;
      checkoutUrl: string | null;
    }
  | { ok: false; error: string }
> {
  const code = params.bookingCode.trim().toUpperCase();
  const email = params.email.trim().toLowerCase();

  const bookings = await db.orm.public.Booking
    .select("id", "status", "totalUsdCents")
    .where((f) => f.code.eq(code))
    .limit(1)
    .all();

  const booking = bookings[0];
  if (!booking) return { ok: false, error: "Pesanan tidak ditemukan." };

  const contacts = await db.orm.public.Contact
    .select("email")
    .where((f) => f.bookingId.eq(booking.id))
    .limit(1)
    .all();

  if (!contacts[0] || contacts[0].email.trim().toLowerCase() !== email) {
    return { ok: false, error: "Pesanan tidak ditemukan." };
  }

  let payment = await getBookingPayment(booking.id);

  // While the payment is still open, ask the gateway for the latest status —
  // the return page self-heals even when the notification is late.
  if (
    payment &&
    payment.status === "pending" &&
    (payment.provider === "xendit" || payment.provider === "paypal")
  ) {
    await refreshPayment(payment.id);
    payment = await getBookingPayment(booking.id);
  }

  // The 5-minute window is over and nothing was paid — report the attempt as
  // expired instead of letting the return page poll a dead session forever.
  const expired =
    !!payment &&
    payment.status === "pending" &&
    !!payment.expiresAt &&
    new Date(payment.expiresAt).getTime() <= Date.now();

  const bookingStatus =
    payment?.status === "paid" ? "confirmed" : booking.status;

  return {
    ok: true,
    status: expired ? "expired" : (payment?.status ?? "pending"),
    bookingStatus,
    amountUsdCents: booking.totalUsdCents,
    checkoutUrl: payment?.checkoutUrl ?? null,
  };
}

/**
 * Credit the loyalty points of a booking that was just paid for.
 *
 * The balance is re-derived from the source rows (paid bookings minus
 * redeemed vouchers), so calling this twice — webhook and return page — is
 * harmless. A points failure never blocks the payment confirmation.
 */
async function awardPointsForBooking(bookingId: string): Promise<void> {
  try {
    const rows = await db.orm.public.Booking
      .select("userId")
      .where((f) => f.id.eq(bookingId))
      .limit(1)
      .all();
    const userId = rows[0]?.userId;
    if (userId) await recomputeUserPoints(userId);
  } catch (error) {
    console.error("[payments] could not credit loyalty points", error);
  }
}

/**
 * Whether our payment attempt for a provider reference is past its 5-minute
 * window. Used by the PayPal webhook to refuse a late capture — PayPal has no
 * order expiry of its own, so this is the only enforcement point.
 *
 * `false` when no attempt is known or it has no expiry — unknown references
 * keep their existing behaviour instead of being blocked.
 */
export async function isAttemptExpired(
  provider: string,
  providerRef: string,
): Promise<boolean> {
  const rows = await db.orm.public.Payment
    .select("expiresAt", "status")
    .where((f) => f.provider.eq(provider))
    .where((f) => f.providerRef.eq(providerRef))
    .limit(1)
    .all();

  const attempt = rows[0];
  if (!attempt || !attempt.expiresAt || attempt.status === "paid") return false;
  return new Date(attempt.expiresAt).getTime() <= Date.now();
}

/** Refresh a pending payment from the gateway — used by the return page. */
export async function refreshPayment(paymentId: string): Promise<string | null> {
  const rows = await db.orm.public.Payment
    .select(
      "id",
      "bookingId",
      "provider",
      "providerRef",
      "status",
      "providerAmountCents",
      "expiresAt",
      "methodId",
      "fxRate",
      "rawPayload",
      "reference",
      "checkoutUrl",
      "amountUsdCents",
    )
    .where({ id: paymentId })
    .limit(1)
    .all();

  const payment = rows[0];
  if (
    !payment ||
    (payment.provider !== "xendit" && payment.provider !== "paypal") ||
    !payment.providerRef
  ) {
    return payment?.status ?? "pending";
  }
  if (payment.status === "paid") return "paid";

  // PayPal — read the order back. The money only moves with a capture, and
  // a capture is only valid once the payer approved the order.
  if (payment.provider === "paypal") {
    try {
      let order = await getOrder(payment.providerRef);
      let capture = extractCapture(order);

      // The 5-minute window is over and nothing moved — do NOT capture. An
      // approval that arrives late is left alone; the attempt stays pending
      // and getPaymentStatus reports it as expired. A capture that already
      // happened (money moved) is still settled below.
      const windowClosed =
        !!payment.expiresAt &&
        new Date(payment.expiresAt).getTime() <= Date.now();

      // APPROVED with nothing captured yet is the one state where the
      // capture call belongs — a CREATED / PAYER_ACTION_REQUIRED order
      // would throw ORDER_NOT_APPROVED, and the return page polls this.
      // captureOrder is idempotent, so racing the webhook is safe.
      if (!capture && !windowClosed && (order.status ?? "").toUpperCase() === "APPROVED") {
        order = await captureOrder(payment.providerRef);
        capture = extractCapture(order);
      }

      // The capture is the money movement — its status wins. No capture:
      // nothing moved yet, the row stays as it is.
      if (capture) {
        if (capture.status === "paid") {
          // The same amount rule as the webhook — a mismatch never confirms.
          const received = capture.amountCents;
          if (
            typeof received === "number" &&
            typeof payment.providerAmountCents === "number" &&
            received !== payment.providerAmountCents
          ) {
            console.error("[payments] amount mismatch on status refresh", {
              expected: payment.providerAmountCents,
              received,
            });
            return payment.status;
          }

          await confirmPaidPayment(payment.id, payment.bookingId, order);
          return "paid";
        }

        if (capture.status === "failed" && payment.status !== "failed") {
          await db.orm.public.Payment
            .where({ id: payment.id })
            .update({ status: "failed", rawPayload: order as never });
          return "failed";
        }
      }

      return payment.status;
    } catch (error) {
      console.error("[payments] could not refresh the payment", error);
      return payment.status;
    }
  }

  // Saved-card attempt, tokenization stage — the provider reference is the
  // payment token (3DS was pending). Once the token turns ACTIVE the charge
  // is created right here; the waiting page keeps polling this refresh.
  if (payment.provider === "xendit" && payment.providerRef.startsWith("pt-")) {
    try {
      const token = await getPaymentToken(payment.providerRef);
      const status = (token.status ?? "").toUpperCase();

      if (status === "FAILED" || status === "CANCELED" || status === "EXPIRED") {
        if (payment.status !== "failed") {
          await db.orm.public.Payment
            .where({ id: payment.id })
            .update({ status: "failed", rawPayload: token as never });
        }
        return "failed";
      }
      if (status !== "ACTIVE") return payment.status;

      const bookingRows = await db.orm.public.Booking
        .select("id", "code", "totalUsdCents")
        .where({ id: payment.bookingId })
        .limit(1)
        .all();
      const contactRows = await db.orm.public.Contact
        .select("firstName", "lastName")
        .where((f) => f.bookingId.eq(payment.bookingId))
        .limit(1)
        .all();
      const bookingRow = bookingRows[0];
      const contactRow = contactRows[0];
      if (!bookingRow || !contactRow) return payment.status;

      const priorRaw = payment.rawPayload as Record<string, unknown> | null;
      const savedCardMeta = (
        priorRaw && typeof priorRaw.savedCard === "object" && priorRaw.savedCard
          ? { savedCard: priorRaw.savedCard as { cardId: string; brand: string; last4: string } }
          : { savedCard: { cardId: "", brand: "card", last4: "" } }
      ) as { savedCard: { cardId: string; brand: string; last4: string } };

      const result = await chargeWithToken({
        booking: bookingRow,
        contact: contactRow,
        existing: payment,
        methodId: payment.methodId ?? "",
        tokenId: payment.providerRef,
        invoiceNumber: payment.reference ?? `INV-${bookingRow.code}`,
        amountUsdCents: payment.amountUsdCents,
        amountIdr: (payment.providerAmountCents ?? 0) / 100,
        rate: payment.fxRate || 1,
        savedCardMeta,
      });

      if (!result.ok) return "failed";
      return result.status === "paid" ? "paid" : payment.status;
    } catch (error) {
      console.error("[payments] could not refresh the saved-card token", error);
      return payment.status;
    }
  }

  // Saved-card attempt, charge stage — the provider reference is the payment
  // request id.
  if (payment.provider === "xendit" && payment.providerRef.startsWith("pr-")) {
    try {
      const request = await getPaymentRequest(payment.providerRef);
      const status = mapGatewayStatus(request.status);

      if (status === "paid") {
        const received =
          typeof request.request_amount === "number"
            ? Math.round(request.request_amount * 100)
            : undefined;
        if (
          typeof received === "number" &&
          typeof payment.providerAmountCents === "number" &&
          received !== payment.providerAmountCents
        ) {
          console.error("[payments] amount mismatch on status refresh", {
            expected: payment.providerAmountCents,
            received,
          });
          return payment.status;
        }
        await confirmPaidPayment(payment.id, payment.bookingId, request);
        return "paid";
      }

      if (status === "failed" && payment.status !== "failed") {
        await db.orm.public.Payment
          .where({ id: payment.id })
          .update({ status: "failed", rawPayload: request as never });
        return "failed";
      }

      if (status === "requires_action") {
        const url = redirectActionUrl(request.actions);
        if (url && url !== payment.checkoutUrl) {
          await db.orm.public.Payment
            .where({ id: payment.id })
            .update({ checkoutUrl: url });
        }
      }

      return payment.status;
    } catch (error) {
      console.error("[payments] could not refresh the saved-card charge", error);
      return payment.status;
    }
  }

  try {
    const session = await getCardSession(payment.providerRef);
    const status = mapGatewayStatus(session.status);

    if (status === "paid") {
      // The same amount rule as the webhook — a mismatch never confirms.
      const received =
        typeof session.amount === "number"
          ? Math.round(session.amount * 100)
          : undefined;
      if (
        typeof received === "number" &&
        typeof payment.providerAmountCents === "number" &&
        received !== payment.providerAmountCents
      ) {
        console.error("[payments] amount mismatch on status refresh", {
          expected: payment.providerAmountCents,
          received,
        });
        return payment.status;
      }

      await confirmPaidPayment(payment.id, payment.bookingId, session);
      return "paid";
    }

    if (status === "failed" && payment.status !== "failed") {
      await db.orm.public.Payment
        .where({ id: payment.id })
        .update({ status: "failed", rawPayload: session as never });
      return "failed";
    }

    return payment.status;
  } catch (error) {
    console.error("[payments] could not refresh the payment", error);
    return payment.status;
  }
}

/**
 * The full payload of the waiting and success pages.
 *
 * Ownership is proven with the contact email — the same rule the payment
 * start and the invoice use. The payment is refreshed from the gateway
 * first, so a late webhook never shows a stale status.
 */
export type PaymentPageData = {
  invoice: InvoiceDTO;
  payment: {
    status: string;
    checkoutUrl: string | null;
    expiresAt: string | null;
    methodLabel: string | null;
    paidAt: string | null;
    /** The masked saved card of a saved-card charge, when that was used. */
    savedCard: { brand: string; last4: string } | null;
  };
  /** The e-VOA application of this booking, when it carries one. */
  visaCode: string | null;
};

export async function getPaymentPageData(params: {
  bookingCode: string;
  email: string;
}): Promise<{ ok: true; data: PaymentPageData } | { ok: false; error: string }> {
  const code = params.bookingCode.trim().toUpperCase();
  const email = params.email.trim().toLowerCase();

  const bookings = await db.orm.public.Booking
    .select("id", "code")
    .where((f) => f.code.eq(code))
    .limit(1)
    .all();
  const booking = bookings[0];
  if (!booking) return { ok: false, error: "Pesanan tidak ditemukan." };

  const contacts = await db.orm.public.Contact
    .select("email")
    .where((f) => f.bookingId.eq(booking.id))
    .limit(1)
    .all();
  if (!contacts[0] || contacts[0].email.trim().toLowerCase() !== email) {
    return { ok: false, error: "Pesanan tidak ditemukan." };
  }

  let payment = await getBookingPayment(booking.id);
  if (
    payment &&
    payment.status === "pending" &&
    (payment.provider === "xendit" || payment.provider === "paypal")
  ) {
    await refreshPayment(payment.id);
    payment = await getBookingPayment(booking.id);
  }

  const invoice = await loadInvoice(booking.id);
  if (!invoice) return { ok: false, error: "Pesanan tidak ditemukan." };

  let visaCode: string | null = null;
  try {
    const applications = await db.orm.public.VisaApplication
      .select("code")
      .where((f) => f.bookingId.eq(booking.id))
      .limit(1)
      .all();
    visaCode = applications[0]?.code ?? null;
  } catch {
    visaCode = null;
  }

  const raw = payment?.rawPayload as Record<string, unknown> | null;
  const savedCardRaw =
    raw && typeof raw.savedCard === "object" && raw.savedCard
      ? (raw.savedCard as Record<string, unknown>)
      : null;

  return {
    ok: true,
    data: {
      invoice,
      payment: {
        status: payment?.status ?? "pending",
        checkoutUrl: payment?.checkoutUrl ?? null,
        expiresAt: payment?.expiresAt ? new Date(payment.expiresAt).toISOString() : null,
        methodLabel: invoice.payment?.methodLabel ?? null,
        paidAt: payment?.paidAt ? new Date(payment.paidAt).toISOString() : null,
        savedCard:
          savedCardRaw && typeof savedCardRaw.last4 === "string"
            ? {
                brand: typeof savedCardRaw.brand === "string" ? savedCardRaw.brand : "card",
                last4: savedCardRaw.last4,
              }
            : null,
      },
      visaCode,
    },
  };
}

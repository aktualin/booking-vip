import "server-only";

import { db } from "@/prisma/db";
import { convertUsdCents, getUsdRate } from "@/lib/fx";
import { recomputeUserPoints } from "@/lib/loyalty";
import {
  chargeCard,
  checkStatus,
  checkThreeDSecure,
  createCardPaymentPage,
  createQrisCheckout,
  dokuCardSdkUrl,
  mapGatewayStatus,
  type GatewayPayment,
} from "@/lib/doku";

/**
 * The payment service.
 *
 * It owns the lifecycle of a payment row: it creates the gateway payment,
 * stores the provider references on the row, and applies the state transition
 * when the gateway tells us the money arrived.
 *
 * The gateway is DOKU (non-SNAP): Credit Card via the Card Payment Page and
 * QRIS via DOKU Checkout. Credentials live in the environment only.
 *
 * The rules that matter:
 *
 *   - the amount is always the one the server computed for the booking,
 *     never one that came from the browser;
 *   - a webhook only confirms the booking when the amount matches;
 *   - a replayed webhook changes nothing (the event id is unique).
 */

export type PaymentMethodDTO = {
  id: string;
  code: string;
  label: string;
  provider: string | null;
  providerMethodCode: string | null;
  providerCurrency: string | null;
};

/** The payment methods that can be started, with their gateway binding. */
export async function listPaymentMethods(): Promise<PaymentMethodDTO[]> {
  const rows = await db.orm.public.PaymentMethod
    .select(
      "id",
      "code",
      "label",
      "provider",
      "providerMethodCode",
      "providerCurrency",
    )
    .where((f) => f.active.eq(true))
    .orderBy((f) => f.sortOrder.asc())
    .all();

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    provider: row.provider ?? null,
    providerMethodCode: row.providerMethodCode ?? null,
    providerCurrency: row.providerCurrency ?? null,
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
      "currencyCode",
      "provider",
      "providerRef",
      "providerAmountCents",
      "providerCurrency",
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
 * The DOKU invoice number for an attempt.
 *
 * The booking invoice (`#INV/YYYY/MM/DD/NNNN/XX`, 24 chars) is used as-is on
 * the first attempt; retries get a `-R<n>` suffix so a failed or expired
 * transaction never collides with the new one. The Credit Card channel caps
 * invoice numbers at 30 characters — the suffix keeps us under it.
 */
function invoiceForAttempt(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  return `${base}-R${attempt}`.slice(0, 30);
}

/** The DOKU JS session id stored in a payment's raw create response, if any. */
function sessionIdFromRaw(raw: unknown): string | null {
  const r = raw as { credit_card_js?: { session_id?: string } } | null;
  return r?.credit_card_js?.session_id ?? null;
}

/** The successful start-payment payload shared by every return path. */
type StartPaymentOk = {
  ok: true;
  checkoutUrl: string;
  paymentId: string;
  channel: "CREDIT_CARD" | "QRIS";
  /** DOKU JS session id for an embedded card form (null when not activated). */
  sessionId: string | null;
  /** The DOKU JS SDK URL for the card channel (null for QRIS). */
  cardSdkUrl: string | null;
};

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
    .select("id", "code", "status", "totalUsdCents", "currencyCode", "invoiceNumber")
    .where((f) => f.code.eq(code))
    .limit(1)
    .all();

  const booking = bookings[0];
  if (!booking) return { ok: false, error: "Pesanan tidak ditemukan." };

  const contacts = await db.orm.public.Contact
    .select("email", "firstName", "lastName")
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
  if (method.provider !== "doku") {
    return { ok: false, error: "Metode pembayaran ini belum didukung." };
  }

  const channel = (method.providerMethodCode ?? "").toUpperCase();
  if (channel !== "CREDIT_CARD" && channel !== "QRIS") {
    return { ok: false, error: "Metode pembayaran ini belum didukung." };
  }

  // Re-use an open payment instead of creating a second one — as long as
  // the hosted page has not expired in the meantime.
  const existing = await getBookingPayment(booking.id);
  if (
    existing &&
    existing.status === "pending" &&
    existing.provider === "doku" &&
    existing.providerRef &&
    existing.checkoutUrl &&
    (!existing.expiresAt || existing.expiresAt.getTime() > Date.now())
  ) {
    return {
      ok: true,
      checkoutUrl: existing.checkoutUrl,
      paymentId: existing.id,
      channel,
      sessionId: sessionIdFromRaw(existing.rawPayload),
      cardSdkUrl: channel === "CREDIT_CARD" ? dokuCardSdkUrl() : null,
    };
  }

  // DOKU charges in IDR — the USD total is converted with the rate of the
  // moment the payment is created. DOKU amounts are integers without
  // decimals, so the converted cents are rounded to whole rupiah.
  const currency = method.providerCurrency ?? "IDR";
  const rate =
    currency.toUpperCase() === (booking.currencyCode ?? "USD").toUpperCase()
      ? 1
      : await getUsdRate(currency);
  const amountCents = convertUsdCents(booking.totalUsdCents, rate);
  const amountIdr = Math.max(1, Math.round(amountCents / 100));

  // Count the previous attempts so a retry gets a fresh invoice number.
  const previous = await db.orm.public.Payment
    .select("id")
    .where((f) => f.bookingId.eq(booking.id))
    .where((f) => f.provider.eq("doku"))
    .all();
  const invoiceNumber = invoiceForAttempt(
    booking.invoiceNumber ?? `INV-${booking.code}`,
    previous.length + 1,
  );

  const input = {
    invoiceNumber,
    amountIdr,
    payerEmail: email,
    payerName:
      `${contacts[0].firstName} ${contacts[0].lastName}`.trim() || undefined,
    description: `Booking VIP ${booking.code}`,
    successRedirectUrl: successUrl(booking.code),
    failureRedirectUrl: failureUrl(booking.code),
  };

  const payment: GatewayPayment =
    channel === "CREDIT_CARD"
      ? await createCardPaymentPage(input)
      : await createQrisCheckout(input);

  const gatewayData = {
    methodId: method.id,
    status: "pending",
    amountUsdCents: booking.totalUsdCents,
    currencyCode: booking.currencyCode,
    fxRate: rate,
    reference: payment.providerRef,
    provider: "doku",
    providerRef: payment.providerRef,
    providerAmountCents: payment.amountCents,
    providerCurrency: payment.currency,
    checkoutUrl: payment.checkoutUrl ?? null,
    expiresAt: payment.expiresAt ?? null,
    rawPayload: payment.raw as never,
  };

  // The booking was created with a placeholder payment row — fill it with
  // the gateway data instead of adding a second row. A retry after a failed
  // or expired attempt still gets a fresh row.
  let paymentId: string;
  if (
    existing &&
    existing.status === "pending" &&
    !existing.provider &&
    !existing.providerRef
  ) {
    paymentId = existing.id;
    await db.orm.public.Payment
      .where((f) => f.id.eq(existing.id))
      .update(gatewayData);
  } else {
    paymentId = crypto.randomUUID();
    await db.orm.public.Payment.create({
      id: paymentId,
      bookingId: booking.id,
      ...gatewayData,
    });
  }

  if (!payment.checkoutUrl) {
    return { ok: false, error: "Gateway tidak mengembalikan link pembayaran." };
  }

  return {
    ok: true,
    checkoutUrl: payment.checkoutUrl,
    paymentId,
    channel,
    sessionId: payment.sessionId ?? null,
    cardSdkUrl: channel === "CREDIT_CARD" ? dokuCardSdkUrl() : null,
  };
}

// ---------------------------------------------------------------------------
// Host-to-Host card payment — the card form lives on OUR page
// ---------------------------------------------------------------------------

/**
 * The short-lived CVV vault.
 *
 * The 3DS step sends the customer away to the issuer's page between "card
 * entered" and "charge". The CVV needed for the charge is kept here — in
 * memory only, for 15 minutes, deleted on read. It is NEVER written to the
 * database, the logs, or any disk. Single-instance deployments only.
 */
const CVV_TTL_MS = 15 * 60 * 1000;

/**
 * The vault lives on `globalThis`, NOT on the module: server actions and
 * route handlers can get separate module instances (especially in dev),
 * so a module-level Map would "lose" the CVV between the action that starts
 * the payment and the 3DS return route that charges it. globalThis is shared
 * by the whole process.
 */
const globalForVault = globalThis as unknown as {
  __cardCvvVault?: Map<string, { cvv: string; expiresAt: number }>;
};
const cvvVault: Map<string, { cvv: string; expiresAt: number }> =
  (globalForVault.__cardCvvVault ??= new Map());

function stashCvv(paymentId: string, cvv: string): void {
  // Sweep expired entries on every write so the map never grows unbounded.
  const now = Date.now();
  for (const [key, entry] of cvvVault) {
    if (entry.expiresAt < now) cvvVault.delete(key);
  }
  cvvVault.set(paymentId, { cvv, expiresAt: now + CVV_TTL_MS });
}

/** Read (and delete) the CVV of a payment, or null when it expired. */
function takeCvv(paymentId: string): string | null {
  const entry = cvvVault.get(paymentId);
  cvvVault.delete(paymentId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.cvv;
}

/** Sanitize the raw card input — throws with a customer-safe message. */
function sanitizeCardInput(cardNumber: string, cardExpiry: string, cardCvv: string): {
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
} {
  const number = cardNumber.replace(/[\s-]/g, "");
  const expiry = cardExpiry.trim();
  const cvv = cardCvv.trim();
  if (!/^[0-9]{13,19}$/.test(number)) throw new Error("Nomor kartu tidak valid.");
  if (!/^[0-9]{4}$/.test(expiry) || Number(expiry.slice(0, 2)) < 1 || Number(expiry.slice(0, 2)) > 12) {
    throw new Error("Masa berlaku kartu tidak valid.");
  }
  if (!/^[0-9]{3,4}$/.test(cvv)) throw new Error("CVV tidak valid.");
  return { cardNumber: number, cardExpiry: expiry, cardCvv: cvv };
}

/** The URL DOKU sends the customer back to after the 3DS step. */
function threeDsReturnUrl(bookingCode: string, paymentId: string, failed: boolean): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "http://localhost:3000";
  return (
    `${base.replace(/\/+$/, "")}/payment/3ds/return` +
    `?code=${encodeURIComponent(bookingCode)}&pid=${encodeURIComponent(paymentId)}` +
    (failed ? "&state=failed" : "")
  );
}

/**
 * Start a direct (Host-to-Host) card payment.
 *
 * The customer entered the card on OUR page. The server starts the 3DS
 * authentication with DOKU and returns the authentication URL the browser
 * must redirect to. The payment row is persisted BEFORE the 3DS call so the
 * return route can find it; the card data itself is never stored — only the
 * 3DS identifiers land on the row, and the CVV in the in-memory vault.
 */
export async function startCardDirectPayment(params: {
  bookingCode: string;
  email: string;
  cardNumber: string;
  /** MMYY, e.g. "0131". */
  cardExpiry: string;
  cardCvv: string;
}): Promise<
  | { ok: true; authenticationUrl: string }
  | { ok: false; error: string }
> {
  try {
    const code = params.bookingCode.trim().toUpperCase();
    const email = params.email.trim().toLowerCase();

    // The card input is validated first — an invalid card never reaches DOKU.
    let card: ReturnType<typeof sanitizeCardInput>;
    try {
      card = sanitizeCardInput(params.cardNumber, params.cardExpiry, params.cardCvv);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }

    const bookings = await db.orm.public.Booking
      .select("id", "code", "status", "totalUsdCents", "currencyCode", "invoiceNumber")
      .where((f) => f.code.eq(code))
      .limit(1)
      .all();
    const booking = bookings[0];
    if (!booking) return { ok: false, error: "Pesanan tidak ditemukan." };

    const contacts = await db.orm.public.Contact
      .select("email", "firstName", "lastName", "phone")
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
    const cardMethod = methods.find((m) => m.providerMethodCode === "CREDIT_CARD" && m.provider === "doku");
    if (!cardMethod) return { ok: false, error: "Metode pembayaran tidak tersedia." };

    // DOKU charges in IDR — the same conversion rule as the hosted flow.
    const currency = cardMethod.providerCurrency ?? "IDR";
    const rate =
      currency.toUpperCase() === (booking.currencyCode ?? "USD").toUpperCase()
        ? 1
        : await getUsdRate(currency);
    const amountCents = convertUsdCents(booking.totalUsdCents, rate);
    const amountIdr = Math.max(1, Math.round(amountCents / 100));

    // A fresh invoice for every direct-card attempt: a previous pending row
    // was already used for a (possibly half-finished) 3DS session.
    const previous = await db.orm.public.Payment
      .select("id")
      .where((f) => f.bookingId.eq(booking.id))
      .where((f) => f.provider.eq("doku"))
      .all();
    const invoiceNumber = invoiceForAttempt(
      booking.invoiceNumber ?? `INV-${booking.code}`,
      previous.length + 1,
    );

    // 1. Persist the payment row first — the 3DS return URL needs its id.
    const placeholder = await getBookingPayment(booking.id);
    const isPlaceholder =
      placeholder && placeholder.status === "pending" && !placeholder.provider && !placeholder.providerRef;

    let paymentId: string;
    const rowBase = {
      methodId: cardMethod.id,
      status: "pending",
      amountUsdCents: booking.totalUsdCents,
      currencyCode: booking.currencyCode,
      fxRate: rate,
      provider: "doku",
      providerRef: invoiceNumber,
      reference: invoiceNumber,
      providerAmountCents: amountCents,
      providerCurrency: "IDR",
      checkoutUrl: null,
      expiresAt: new Date(Date.now() + CVV_TTL_MS),
    };
    if (isPlaceholder) {
      paymentId = placeholder.id;
      await db.orm.public.Payment.where({ id: paymentId }).update(rowBase as never);
    } else {
      paymentId = crypto.randomUUID();
      await db.orm.public.Payment.create({ id: paymentId, bookingId: booking.id, ...rowBase } as never);
    }

    // 2. Ask DOKU to start the 3DS authentication for this card.
    //    Card number/expiry are used for this request only — never stored.
    let session;
    try {
      session = await checkThreeDSecure({
        invoiceNumber,
        amountIdr,
        cardNumber: card.cardNumber,
        cardExpiry: card.cardExpiry,
        customer: {
          name: `${contacts[0].firstName} ${contacts[0].lastName}`.trim() || undefined,
          email,
          phone: contacts[0].phone || undefined,
        },
        successUrl: threeDsReturnUrl(booking.code, paymentId, false),
        failureUrl: threeDsReturnUrl(booking.code, paymentId, true),
      });
    } catch (error) {
      console.error("[payments] check-3ds failed", (error as Error).message);
      return { ok: false, error: "Kartu tidak bisa diproses. Coba lagi." };
    }

    // 3. Remember the 3DS identifiers (no card data) and the CVV (memory only).
    await db.orm.public.Payment
      .where({ id: paymentId })
      .update({
        rawPayload: {
          three_ds: {
            authentication_id: session.authenticationId,
            authentication_url: session.authenticationUrl,
          },
        } as never,
      });
    stashCvv(paymentId, card.cardCvv);

    return { ok: true, authenticationUrl: session.authenticationUrl };
  } catch (error) {
    // Never log card data — the error itself may only carry a message.
    console.error("[payments] could not start the direct card payment", (error as Error).message);
    return { ok: false, error: "Pembayaran kartu tidak bisa dimulai. Coba lagi." };
  }
}

/**
 * Finish the direct card payment after the 3DS redirect: charge the card with
 * the stored authentication id and the vaulted CVV. The DOKU notification
 * still lands on the webhook afterwards — the confirm path is idempotent.
 */
export async function completeCardDirectPayment(
  paymentId: string,
  failed: boolean,
): Promise<{ ok: true; paid: boolean; error?: string }> {
  try {
    const rows = await db.orm.public.Payment
      .select("id", "bookingId", "provider", "providerRef", "status", "providerAmountCents", "rawPayload")
      .where({ id: paymentId })
      .limit(1)
      .all();
    const payment = rows[0];
    if (!payment || payment.provider !== "doku" || !payment.providerRef) {
      return { ok: true, paid: false, error: "Pembayaran tidak ditemukan." };
    }
    if (payment.status === "paid") return { ok: true, paid: true };

    if (failed) {
      await db.orm.public.Payment
        .where({ id: payment.id })
        .update({ status: "failed" } as never);
      return { ok: true, paid: false, error: "Verifikasi 3D Secure dibatalkan." };
    }

    const raw = payment.rawPayload as { three_ds?: { authentication_id?: string } } | null;
    const authenticationId = raw?.three_ds?.authentication_id;
    if (!authenticationId) {
      return { ok: true, paid: false, error: "Sesi 3D Secure tidak ditemukan." };
    }

    const cvv = takeCvv(paymentId);
    if (!cvv) {
      await db.orm.public.Payment
        .where({ id: payment.id })
        .update({ status: "failed" } as never);
      return { ok: true, paid: false, error: "Sesi pembayaran kedaluwarsa — silakan ulangi pembayaran." };
    }

    const bookings = await db.orm.public.Booking
      .select("id", "code", "totalUsdCents", "currencyCode", "invoiceNumber")
      .where({ id: payment.bookingId })
      .limit(1)
      .all();
    const booking = bookings[0];
    if (!booking) return { ok: true, paid: false, error: "Pesanan tidak ditemukan." };

    const contacts = await db.orm.public.Contact
      .select("email", "firstName", "lastName", "phone")
      .where({ bookingId: booking.id })
      .limit(1)
      .all();

    const amountIdr = Math.max(1, Math.round((payment.providerAmountCents ?? 0) / 100));
    const charged = await chargeCard({
      invoiceNumber: payment.providerRef,
      amountIdr,
      customer: {
        name: contacts[0]
          ? `${contacts[0].firstName} ${contacts[0].lastName}`.trim() || undefined
          : undefined,
        email: contacts[0]?.email ?? "customer@bookingvip.local",
        phone: contacts[0]?.phone || undefined,
      },
      authenticationId,
      cvv,
    });

    if (charged.status === "paid") {
      await confirmPaidPayment(payment.id, payment.bookingId, charged.raw);
      return { ok: true, paid: true };
    }

    await db.orm.public.Payment
      .where({ id: payment.id })
      .update({ status: "failed", rawPayload: charged.raw as never } as never);
    return { ok: true, paid: false, error: "Pembayaran kartu ditolak." };
  } catch (error) {
    console.error("[payments] could not complete the direct card payment", (error as Error).message);
    return { ok: true, paid: false, error: "Pembayaran tidak bisa diselesaikan." };
  }
}

/** The URL the customer comes back to after paying. */
function successUrl(bookingCode: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/payment/return?code=${encodeURIComponent(bookingCode)}`;
}

/** The URL the customer comes back to when the payment fails. */
function failureUrl(bookingCode: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/payment/return?code=${encodeURIComponent(bookingCode)}&status=failed`;
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

  // Find the payment by the provider reference — for DOKU that is the
  // invoice number we generated.
  const payments = await db.orm.public.Payment
    .select("id", "bookingId", "status", "amountUsdCents", "providerAmountCents", "providerCurrency")
    .where((f) => f.provider.eq(params.provider))
    .where((f) => f.providerRef.eq(params.providerRef ?? ""))
    .limit(1)
    .all();

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
  await db.orm.public.Payment
    .where((f) => f.id.eq(paymentId))
    .update({
      status: "paid",
      paidAt: new Date(),
      ...(raw !== undefined ? { rawPayload: raw as never } : {}),
    });

  await db.orm.public.Booking
    .where((f) => f.id.eq(bookingId))
    .update({ status: "confirmed" });

  await awardPointsForBooking(bookingId);
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
  if (payment && payment.status === "pending" && payment.provider === "doku") {
    await refreshPayment(payment.id);
    payment = await getBookingPayment(booking.id);
  }

  const bookingStatus =
    payment?.status === "paid" ? "confirmed" : booking.status;

  return {
    ok: true,
    status: payment?.status ?? "pending",
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

/** Refresh a pending payment from the gateway — used by the return page. */
export async function refreshPayment(paymentId: string): Promise<string | null> {
  const rows = await db.orm.public.Payment
    .select("id", "bookingId", "provider", "providerRef", "status", "providerAmountCents")
    .where((f) => f.id.eq(paymentId))
    .limit(1)
    .all();

  const payment = rows[0];
  if (!payment || payment.provider !== "doku" || !payment.providerRef) {
    return payment?.status ?? "pending";
  }
  if (payment.status === "paid") return "paid";

  try {
    const refreshed = await checkStatus(payment.providerRef);
    const status = mapGatewayStatus(refreshed.transaction?.status);

    if (status === "paid") {
      // The same amount rule as the webhook — a mismatch never confirms.
      const received =
        typeof refreshed.order?.amount === "number"
          ? Math.round(refreshed.order.amount * 100)
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

      await confirmPaidPayment(payment.id, payment.bookingId, refreshed);
      return "paid";
    }

    if (status === "failed" && payment.status !== "failed") {
      await db.orm.public.Payment
        .where((f) => f.id.eq(payment.id))
        .update({ status: "failed", rawPayload: refreshed as never });
      return "failed";
    }

    return payment.status;
  } catch (error) {
    console.error("[payments] could not refresh the payment", error);
    return payment.status;
  }
}
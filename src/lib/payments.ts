import "server-only";

import { db } from "@/prisma/db";
import { convertUsdCentsToIdr, getUsdToIdrRate } from "@/lib/fx";
import { recomputeUserPoints } from "@/lib/loyalty";
import {
  createPaymentSession,
  failureUrl,
  getCardSession,
  mapGatewayStatus,
  successUrl,
  type GatewayPayment,
  type PaymentChannel,
} from "@/lib/xendit";
import { sendBookingConfirmation } from "@/lib/notify";
import { notifyEvoaStatusChange } from "@/lib/evoa-notify";

/**
 * The payment service.
 *
 * It owns the lifecycle of a payment row: it creates the gateway payment,
 * stores the provider references on the row, and applies the state transition
 * when the gateway tells us the money arrived.
 *
 * The gateway is Xendit (Payments API v3): Credit Card, QRIS and Virtual
 * Account, each via a PAYMENT_LINK Payment Session — the customer pays on
 * Xendit's hosted checkout page. Credentials live in the environment only.
 *
 * Prices are stored and displayed in USD. Xendit charges in IDR, so the
 * booking total (USD cents) is converted to whole rupiah with the live
 * USD→IDR rate at session creation; the rate and the IDR amount are frozen
 * on the payment row (`fxRate`, `providerAmountCents`, `providerCurrency`).
 *
 * The rules that matter:
 *
 *   - the amount is always the one the server computed for the booking,
 *     never one that came from the browser;
 *   - a webhook only confirms the booking when the amount matches;
 *   - a replayed webhook changes nothing (the event id is unique).
 */

/** The Xendit channels a PaymentMethod can be bound to. */
const SUPPORTED_CHANNELS: readonly PaymentChannel[] = [
  "CREDIT_CARD",
  "QRIS",
  "VIRTUAL_ACCOUNT",
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
  const cc = countryCode.replace(/\D/g, "");
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
  if (method.provider !== "xendit") {
    return { ok: false, error: "Metode pembayaran ini belum didukung." };
  }

  const channel = (method.providerMethodCode ?? "").toUpperCase() as PaymentChannel;
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    return { ok: false, error: "Metode pembayaran ini belum didukung." };
  }

  // Re-use an open payment instead of creating a second one — as long as
  // it is the SAME method and the hosted page has not expired. Switching
  // the method (e.g. card → QRIS) starts a fresh attempt instead.
  const existing = await getBookingPayment(booking.id);
  if (
    existing &&
    existing.status === "pending" &&
    existing.provider === "xendit" &&
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

  const contact = contacts[0];
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
  };
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
    .select("status")
    .where((f) => f.id.eq(paymentId))
    .limit(1)
    .all();
  const alreadyPaid = priorRows[0]?.status === "paid";

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
  if (payment && payment.status === "pending" && payment.provider === "xendit") {
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
    .where({ id: paymentId })
    .limit(1)
    .all();

  const payment = rows[0];
  if (!payment || payment.provider !== "xendit" || !payment.providerRef) {
    return payment?.status ?? "pending";
  }
  if (payment.status === "paid") return "paid";

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

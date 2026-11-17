import "server-only";

import { db } from "@/prisma/db";
import { recomputeUserPoints } from "@/lib/loyalty";
import {
  createCardSession,
  failureUrl,
  getCardSession,
  mapGatewayStatus,
  successUrl,
  type GatewayPayment,
} from "@/lib/xendit";

/**
 * The payment service.
 *
 * It owns the lifecycle of a payment row: it creates the gateway payment,
 * stores the provider references on the row, and applies the state transition
 * when the gateway tells us the money arrived.
 *
 * The gateway is Xendit (Payments API v3): Credit Card via a PAYMENT_LINK
 * Payment Session — the customer pays on Xendit's hosted checkout page.
 * Credentials live in the environment only.
 *
 * Every amount is USD. The booking total (USD cents) is charged as-is; there
 * is no FX conversion anywhere in the flow.
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

  const channel = (method.providerMethodCode ?? "").toUpperCase();
  if (channel !== "CREDIT_CARD") {
    return { ok: false, error: "Metode pembayaran ini belum didukung." };
  }

  // Re-use an open payment instead of creating a second one — as long as
  // the hosted page has not expired in the meantime.
  const existing = await getBookingPayment(booking.id);
  if (
    existing &&
    existing.status === "pending" &&
    existing.provider === "xendit" &&
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

  // The amount is the booking total in USD — charged as-is, no conversion.
  const amountUsdCents = booking.totalUsdCents;

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
  const payment: GatewayPayment = await createCardSession({
    referenceId: invoiceNumber,
    amountUsdCents,
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

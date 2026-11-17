import { NextResponse } from "next/server";
import { applyGatewayEvent } from "@/lib/payments";
import {
  verifyWebhookToken,
  type XenditChannelPaymentEvent,
  type XenditWebhook,
} from "@/lib/xendit";

/**
 * The Xendit webhook (Payments API v3).
 *
 * Xendit posts session and payment state changes here. The `x-callback-token`
 * header is verified first against XENDIT_WEBHOOK_VERIFICATION_TOKEN — an
 * event without a valid token changes nothing.
 *
 * The event families that arrive:
 *
 *   - `payment_session.completed` / `payment_session.expired` — the session
 *     is our provider reference; `completed` means the payment succeeded.
 *     Covers every channel started through a session (card, QRIS, VA).
 *   - `payment.capture` / `payment.authorization` / `payment.failure` — the
 *     payment-level detail, correlated by our invoice reference.
 *   - `qr.payment` (QRIS) / `va.payment` (Virtual Account) — the
 *     channel-level status events. They arrive FLAT (no `data` envelope):
 *     QRIS nests our reference in `qr_code.external_id`, VA carries
 *     `external_id` directly. PAID / COMPLETED confirm (with the same
 *     amount-match rule), EXPIRED resets the attempt to pending, FAILED
 *     marks it failed.
 *
 * Legacy card events (`credit_card.authentication` / `credit_card.capture` /
 * `credit_card.tokenization`, e.g. the dashboard's test deliveries) carry
 * `data.id` / `data.external_id` instead — they are accepted too, recorded
 * in the webhook ledger, and ignored unless they match one of our payments.
 * We never tokenize or store cards (hosted checkout only), so a tokenization
 * event is informational: its `VERIFIED` status maps to "pending" and can
 * never confirm a booking.
 *
 * The event id used for dedupe is the event name plus the provider object id
 * and status; a replayed delivery is a no-op.
 */

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifyWebhookToken(request.headers.get("x-callback-token"))) {
    return NextResponse.json(
      { ok: false, error: "Invalid callback token." },
      { status: 401 },
    );
  }

  let payload: XenditWebhook;
  try {
    payload = JSON.parse(rawBody) as XenditWebhook;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const event = payload.event?.trim() ?? "";
  // The v3 session/payment events wrap their object in `data`; the
  // channel-level qr.payment / va.payment events are flat — the payload
  // itself is the object.
  const data = (payload.data ?? payload) as NonNullable<XenditWebhook["data"]> &
    XenditChannelPaymentEvent;

  const sessionId = data.payment_session_id?.trim();
  const paymentId = data.payment_id?.trim();
  const legacyId = data.id?.trim();
  const referenceId = data.reference_id?.trim();
  // QRIS nests the merchant reference inside the QR code object.
  const qrExternalId = data.qr_code?.external_id?.trim();
  const externalId = data.external_id?.trim() || qrExternalId;
  const status = data.status ?? "";

  const objectId = sessionId || paymentId || legacyId || referenceId || externalId;
  if (!event || !objectId) {
    return NextResponse.json(
      { ok: false, error: "Missing event id." },
      { status: 400 },
    );
  }

  const eventId = `${event}:${objectId}:${status}`;

  // Session events correlate by the session id (our providerRef); payment
  // and legacy events fall back to our invoice reference inside
  // applyGatewayEvent.
  const providerRef = sessionId || data.payment_request_id || undefined;

  // Xendit amounts are decimal units of the currency (IDR here) — normalize
  // to cents like the rest of the payment service expects.
  const amount =
    typeof data.amount === "number"
      ? data.amount
      : typeof data.request_amount === "number"
        ? data.request_amount
        : undefined;
  const amountCents =
    typeof amount === "number" ? Math.round(amount * 100) : undefined;

  const result = await applyGatewayEvent({
    provider: "xendit",
    eventId,
    eventType: event,
    providerRef,
    externalId: referenceId || externalId,
    status,
    amountCents,
    currency: data.currency ?? "IDR",
    raw: payload,
  });

  return NextResponse.json({ ok: true, outcome: result.outcome });
}

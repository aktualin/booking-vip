import { NextResponse } from "next/server";
import { applyGatewayEvent } from "@/lib/payments";
import { verifyWebhookToken, type XenditWebhook } from "@/lib/xendit";

/**
 * The Xendit webhook (Payments API v3).
 *
 * Xendit posts session and payment state changes here. The `x-callback-token`
 * header is verified first against XENDIT_WEBHOOK_VERIFICATION_TOKEN — an
 * event without a valid token changes nothing.
 *
 * Two event families arrive:
 *
 *   - `payment_session.completed` / `payment_session.expired` — the session
 *     is our provider reference; `completed` means the payment succeeded.
 *   - `payment.capture` / `payment.authorization` / `payment.failure` — the
 *     payment-level detail, correlated by our invoice reference.
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
  const data = payload.data ?? {};

  const sessionId = data.payment_session_id?.trim();
  const paymentId = data.payment_id?.trim();
  const referenceId = data.reference_id?.trim();
  const status = data.status ?? "";

  const objectId = sessionId || paymentId || referenceId;
  if (!event || !objectId) {
    return NextResponse.json(
      { ok: false, error: "Missing event id." },
      { status: 400 },
    );
  }

  const eventId = `${event}:${objectId}:${status}`;

  // Session events correlate by the session id (our providerRef); payment
  // events fall back to our invoice reference inside applyGatewayEvent.
  const providerRef = sessionId || data.payment_request_id || undefined;

  // Xendit amounts are decimal units of the currency (USD here) — normalize
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
    externalId: referenceId,
    status,
    amountCents,
    currency: data.currency ?? "USD",
    raw: payload,
  });

  return NextResponse.json({ ok: true, outcome: result.outcome });
}

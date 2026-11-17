import { NextResponse } from "next/server";
import { applyGatewayEvent, isAttemptExpired } from "@/lib/payments";
import {
  captureOrder,
  extractCapture,
  getOrder,
  orderGatewayStatus,
  PayPalError,
  type PayPalOrder,
  type PayPalWebhook,
} from "@/lib/paypal";

/**
 * The PayPal webhook (Orders API v2, MANUAL capture).
 *
 * PayPal posts order/capture lifecycle events here. There is deliberately NO
 * cryptographic signature verification during the sandbox phase; instead the
 * endpoint SELF-VERIFIES. The webhook body is never trusted for money state —
 * whenever an event could confirm (or fail) a payment we re-read the order
 * server-to-server with `getOrder()` and derive the status and amount from
 * that authoritative response. Combined with the dedupe ledger inside
 * `applyGatewayEvent` (unique on provider + event id) and its amount-match
 * rule, a forged or replayed delivery cannot confirm a booking.
 *
 * The event families that arrive:
 *
 *   - `CHECKOUT.ORDER.APPROVED` — the customer approved on PayPal. We CAPTURE
 *     here (manual-capture design) so the payment completes even if the
 *     customer never returns to /payment/return. A definitive decline is
 *     recorded as "failed"; a transient/network error returns 500 so PayPal
 *     redelivers.
 *   - `CHECKOUT.ORDER.COMPLETED` / `CHECKOUT.ORDER.PROCESSED` — order-level
 *     completion. `resource.id` is the order id.
 *   - `PAYMENT.CAPTURE.COMPLETED` / `PAYMENT.CAPTURE.DENIED` — capture-level
 *     money state. The order id is correlated back through
 *     `resource.supplementary_data.related_ids.order_id`.
 *     All four are re-verified via `getOrder()` before anything is applied.
 *   - `PAYMENT.CAPTURE.REFUNDED` / `PAYMENT.CAPTURE.REVERSED` — informational.
 *     Recorded in the ledger with a normalized "pending" status, which causes
 *     NO state change in `applyGatewayEvent` (it only writes the audit row),
 *     so refunds stay auditable but never un-confirm a booking.
 *   - Anything else (disputes, billing, etc.) is acknowledged with 200 and
 *     NOT recorded, so PayPal stops redelivering.
 *
 * The event id used for dedupe is the envelope's `id` (PayPal's unique event
 * id); if absent we synthesize one from the event type + resource identity.
 * Statuses passed to `applyGatewayEvent` are always our normalized lowercase
 * values (paid / failed / pending / expired / cancelled / requires_action),
 * never raw PayPal strings.
 */

/**
 * PayPal capture issues that mean the payment was DEFINITIVELY rejected —
 * retrying will not help, so we record the event as "failed". Everything
 * else (network errors, 5xx, transient/unexpected 4xx) returns 500 so PayPal
 * redelivers and we never write a premature failure.
 */
const DECLINE_ISSUES = new Set([
  "INSTRUMENT_DECLINED",
  "ORDER_DENIED",
  "PENDING_BILLING_AGREEMENT",
  "PAYEE_ACCOUNT_RESTRICTED_OR_CLOSED",
  "NO_VALID_FUNDING_SOURCE",
  "CARD_TYPE_NOT_SUPPORTED",
  "TRANSACTION_LIMIT_EXCEEDED",
]);

/** A 404 from PayPal — the resource does not (and never will) exist. */
function notFound(error: PayPalError): boolean {
  return error.status === 404 || error.issue === "INVALID_RESOURCE_ID";
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  let payload: PayPalWebhook;
  try {
    payload = JSON.parse(rawBody) as PayPalWebhook;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const event = payload.event_type?.trim() ?? "";
  const resource: NonNullable<PayPalWebhook["resource"]> = payload.resource ?? {};
  const envelopeId = payload.id?.trim();

  // Dedupe key: prefer PayPal's unique envelope id, else synthesize a stable
  // one from the event type + resource identity so a replay still collapses.
  const eventId =
    envelopeId || `${event}:${resource.id ?? ""}:${resource.status ?? ""}`;

  // We need at least an event type or an envelope id to key the ledger on.
  if (!event && !envelopeId) {
    return NextResponse.json(
      { ok: false, error: "Missing event id." },
      { status: 400 },
    );
  }

  // Our invoice number — the correlation fallback inside applyGatewayEvent
  // (matches Payment.reference when the providerRef lookup misses).
  const externalId = resource.invoice_id?.trim() || undefined;

  switch (event.toUpperCase()) {
    case "CHECKOUT.ORDER.APPROVED": {
      // resource is the order; resource.id is the order id we captured against.
      const orderId = resource.id?.trim();
      if (!orderId) {
        return NextResponse.json(
          { ok: false, error: "Missing order id." },
          { status: 400 },
        );
      }

      let order: PayPalOrder;
      try {
        // The 5-minute payment window is enforced on our side — PayPal has no
        // order expiry. A late approval is never captured; the event is
        // recorded as "expired" and the attempt is left for a retry.
        if (await isAttemptExpired("paypal", orderId)) {
          console.warn("[paypal-webhook] approval after the 5-minute window; not capturing", {
            orderId,
          });
          const result = await applyGatewayEvent({
            provider: "paypal",
            eventId,
            eventType: event,
            providerRef: orderId,
            externalId,
            status: "expired",
            currency: "USD",
            raw: payload,
          });
          return NextResponse.json({ ok: true, outcome: result.outcome });
        }

        // captureOrder already swallows ORDER_ALREADY_CAPTURED by reading the
        // order back, so racing the return-page capture is safe.
        order = await captureOrder(orderId);
      } catch (error) {
        if (error instanceof PayPalError && DECLINE_ISSUES.has(error.issue)) {
          // A definitive decline ends this payment — record it as failed.
          const result = await applyGatewayEvent({
            provider: "paypal",
            eventId,
            eventType: event,
            providerRef: orderId,
            externalId,
            status: "failed",
            currency: "USD",
            raw: payload,
          });
          return NextResponse.json({ ok: true, outcome: result.outcome });
        }
        if (error instanceof PayPalError && notFound(error)) {
          // The order does not exist — dashboard simulator events, or an
          // order of another account. Retrying can never help; record it in
          // the ledger (outcome "ignored", no payment matches) and ack.
          console.warn("[paypal-webhook] unknown order on approve; ignoring", {
            orderId,
          });
          const result = await applyGatewayEvent({
            provider: "paypal",
            eventId,
            eventType: event,
            providerRef: orderId,
            externalId,
            status: "pending",
            currency: "USD",
            raw: payload,
          });
          return NextResponse.json({ ok: true, outcome: result.outcome });
        }
        // Network / 5xx / unexpected 4xx — retryable. Do NOT record a failure.
        console.error("[paypal-webhook] capture failed; will retry", error);
        return NextResponse.json(
          { ok: false, error: "Capture failed; will retry." },
          { status: 500 },
        );
      }

      // Derive status + amount from the authoritative capture, never the body.
      const capture = extractCapture(order);
      const status = capture?.status ?? orderGatewayStatus(order);
      const result = await applyGatewayEvent({
        provider: "paypal",
        eventId,
        eventType: event,
        providerRef: orderId,
        externalId,
        status,
        amountCents: capture?.amountCents,
        currency: "USD",
        raw: payload,
      });
      return NextResponse.json({ ok: true, outcome: result.outcome });
    }

    case "CHECKOUT.ORDER.COMPLETED":
    case "CHECKOUT.ORDER.PROCESSED":
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.DENIED": {
      // Money-state events. Capture resources carry the order id under
      // supplementary_data.related_ids; order resources carry it as resource.id.
      const orderId =
        resource.supplementary_data?.related_ids?.order_id?.trim() ||
        resource.id?.trim();
      if (!orderId) {
        return NextResponse.json(
          { ok: false, error: "Missing order id." },
          { status: 400 },
        );
      }

      let order: PayPalOrder;
      try {
        // Self-verify: re-read the order instead of trusting the event body.
        order = await getOrder(orderId);
      } catch (error) {
        if (error instanceof PayPalError && notFound(error)) {
          // Unknown order (simulator sample, other account) — ack without
          // a retry loop; the ledger records the delivery as ignored.
          console.warn("[paypal-webhook] unknown order; ignoring", { orderId });
          const result = await applyGatewayEvent({
            provider: "paypal",
            eventId,
            eventType: event,
            providerRef: orderId,
            externalId,
            status: "pending",
            currency: "USD",
            raw: payload,
          });
          return NextResponse.json({ ok: true, outcome: result.outcome });
        }
        // A verification read failure is retryable — let PayPal redeliver.
        console.error(
          "[paypal-webhook] order verification failed; will retry",
          error,
        );
        return NextResponse.json(
          { ok: false, error: "Order verification failed; will retry." },
          { status: 500 },
        );
      }

      const capture = extractCapture(order);
      // COMPLETED verifies to "paid"; DENIED verifies to "failed" — but we take
      // whatever the authoritative order says, not what the event claimed.
      const status = capture?.status ?? orderGatewayStatus(order);
      const result = await applyGatewayEvent({
        provider: "paypal",
        eventId,
        eventType: event,
        providerRef: orderId,
        externalId,
        status,
        amountCents: capture?.amountCents,
        currency: "USD",
        raw: payload,
      });
      return NextResponse.json({ ok: true, outcome: result.outcome });
    }

    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      // Informational only — no getOrder, no state change. A normalized
      // "pending" writes the audit row (so the refund is traceable) but is a
      // no-op for the payment status inside applyGatewayEvent.
      const orderId = resource.supplementary_data?.related_ids?.order_id?.trim();
      const result = await applyGatewayEvent({
        provider: "paypal",
        eventId,
        eventType: event,
        providerRef: orderId || undefined,
        externalId,
        status: "pending",
        currency: "USD",
        raw: payload,
      });
      return NextResponse.json({ ok: true, outcome: result.outcome });
    }

    default:
      // Unhandled families: acknowledge without recording so PayPal stops
      // redelivering. Nothing is written to the ledger.
      return NextResponse.json({ ok: true, outcome: "ignored" });
  }
}

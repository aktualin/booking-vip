import { NextResponse } from "next/server";
import { applyGatewayEvent } from "@/lib/payments";
import {
  verifyNotificationSignature,
  type DokuTransaction,
} from "@/lib/doku";

/**
 * The DOKU webhook (HTTP Notification, non-SNAP).
 *
 * DOKU posts every transaction state change here. The HMAC-SHA256 signature
 * in the headers is verified first — the Request-Target component is the
 * path of this route. An event without a valid signature changes nothing.
 *
 * The Request-Id header is the event id used for dedupe; the invoice number
 * in the body links the event to our payment row.
 */

/** The path DOKU signs against — must match the configured Notification URL. */
const NOTIFICATION_PATH = "/api/payments/webhook/doku";

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (
    !verifyNotificationSignature({
      headers: request.headers,
      rawBody,
      path: NOTIFICATION_PATH,
    })
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid signature." },
      { status: 401 },
    );
  }

  let payload: DokuTransaction;
  try {
    payload = JSON.parse(rawBody) as DokuTransaction;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const requestId = request.headers.get("request-id")?.trim();
  const invoiceNumber = payload.order?.invoice_number?.trim();
  const status = payload.transaction?.status ?? "";

  const eventId =
    requestId ||
    (invoiceNumber && status ? `${invoiceNumber}:${status}` : "");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "Missing event id." },
      { status: 400 },
    );
  }

  // DOKU amounts are IDR integers — normalize to cents like the rest of
  // the payment service expects.
  const amountCents =
    typeof payload.order?.amount === "number"
      ? Math.round(payload.order.amount * 100)
      : undefined;

  const result = await applyGatewayEvent({
    provider: "doku",
    eventId,
    eventType: `${(payload.service?.id ?? "unknown").toLowerCase()}.${status.toLowerCase()}`,
    providerRef: invoiceNumber,
    externalId: invoiceNumber,
    status,
    amountCents,
    currency: payload.order?.currency ?? "IDR",
    raw: payload,
  });

  return NextResponse.json({ ok: true, outcome: result.outcome });
}
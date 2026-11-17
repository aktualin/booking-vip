import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * The Xendit gateway — Payments API (v3), Payment Sessions.
 *
 * One channel is integrated: Credit Card via a PAYMENT_LINK session. The
 * server creates a session and the customer is redirected to Xendit's hosted
 * checkout page (`payment_link_url`), where the card form and 3DS live — raw
 * card data never touches this server (PCI SAQ A).
 *
 * Every amount is USD. The session is created with `currency: "USD"` and the
 * booking total in USD cents / 100 — there is no FX conversion anywhere.
 * (For Indonesian merchants Xendit settles to the balance in the local
 * currency internally; that is Xendit's side of the integration, never ours.)
 *
 * Authentication is HTTP Basic with the secret API key. Incoming webhooks
 * are verified with the `x-callback-token` header against the webhook
 * verification token configured in the Xendit dashboard.
 *
 * Credentials live in the environment only:
 *
 *   XENDIT_API_KEY                     the secret key (xnd_development_… / xnd_production_…)
 *   XENDIT_WEBHOOK_VERIFICATION_TOKEN  the callback token for webhook verification
 *
 * Return URLs must be HTTPS — local development needs an HTTPS tunnel.
 */

/** The gateway statuses we care about, mapped onto ours. */
export type GatewayStatus =
  | "pending"
  | "requires_action"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled";

/** A normalized payment as returned by the gateway. */
export type GatewayPayment = {
  /** The Xendit payment session id — our provider reference. */
  providerRef: string;
  status: GatewayStatus;
  /** The amount charged, in USD cents. */
  amountCents: number;
  currency: "USD";
  /** Where the customer has to go to pay (the hosted checkout page). */
  checkoutUrl?: string;
  expiresAt?: Date;
  /** The raw provider payload — stored on the payment for auditing. */
  raw: unknown;
};

/** The shape of a Xendit Payment Session (create / get / webhook data). */
export type XenditSession = {
  payment_session_id?: string;
  reference_id?: string;
  customer_id?: string;
  session_type?: string;
  mode?: string;
  status?: string;
  amount?: number;
  currency?: string;
  country?: string;
  payment_link_url?: string;
  payment_request_id?: string | null;
  latest_payment_request_id?: string | null;
  payment_id?: string | null;
  payment_token_id?: string | null;
  expires_at?: string;
  expires_ttl?: number;
  success_return_url?: string;
  cancel_return_url?: string;
  description?: string;
  created?: string;
  updated?: string;
  business_id?: string;
};

/** The shape of a Xendit payment-level webhook (payment.capture / .failure). */
export type XenditPaymentEvent = {
  payment_id?: string;
  payment_request_id?: string;
  reference_id?: string;
  status?: string;
  currency?: string;
  request_amount?: number;
  capture_method?: string;
  channel_code?: string;
  failure_code?: string;
  captures?: { capture_id?: string; capture_amount?: number; capture_timestamp?: string }[];
  created?: string;
  updated?: string;
};

/** The webhook envelope — session-level and payment-level events. */
export type XenditWebhook = {
  event?: string;
  business_id?: string;
  created?: string;
  data?: XenditSession & XenditPaymentEvent;
};

/** Is the Xendit gateway configured? */
export function isXenditConfigured(): boolean {
  return Boolean(process.env.XENDIT_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.XENDIT_API_KEY?.trim();
  if (!key) throw new Error("XENDIT_API_KEY is not configured.");
  return key;
}

/** Map a Xendit session / payment status onto ours. */
export function mapGatewayStatus(status: string | undefined): GatewayStatus {
  switch ((status ?? "").toUpperCase()) {
    case "COMPLETED":
    case "SUCCEEDED":
    case "PAID":
    case "SETTLED":
      return "paid";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    case "REQUIRES_ACTION":
      return "requires_action";
    case "ACTIVE":
    case "PENDING":
    case "AUTHORIZED":
    default:
      return "pending";
  }
}

/** Perform a Basic-auth Xendit API call. */
async function xenditFetch<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const auth = Buffer.from(`${apiKey()}:`).toString("base64");
  const response = await fetch(`https://api.xendit.co${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error body — fall through to the status error below.
  }

  if (!response.ok) {
    const err = json as { error_code?: string; message?: string } | null;
    throw new Error(
      err?.message ??
        `Xendit request failed with status ${response.status}`,
    );
  }

  return json as T;
}

/** The public base URL of this deployment — used for the redirect URLs. */
function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * The session lifetime we rely on. Xendit defaults to 24h on this account;
 * the authoritative expiry is always the `expires_at` in the response.
 */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Sanitize a name for Xendit's alphanumeric-only customer fields. */
function cleanName(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 50);
  return cleaned || fallback;
}

/**
 * Create a PAYMENT_LINK session for a card payment in USD and return its
 * hosted checkout URL.
 *
 * The customer enters the card on Xendit's hosted page; 3DS and the result
 * are handled there. `referenceId` is our invoice number (max 64 chars).
 */
export async function createCardSession(input: {
  referenceId: string;
  amountUsdCents: number;
  payerEmail: string;
  payerFirstName: string;
  payerLastName: string;
  /** E.164 phone (optional) — e.g. "+6281234567890". */
  payerPhone?: string;
  /** Unique alphanumeric customer reference (we use the booking id). */
  customerReferenceId: string;
  description: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}): Promise<GatewayPayment> {
  const amount = Math.max(0.01, input.amountUsdCents / 100);

  const payload = await xenditFetch<XenditSession>("POST", "/sessions", {
    reference_id: input.referenceId.slice(0, 64),
    session_type: "PAY",
    mode: "PAYMENT_LINK",
    amount,
    currency: "USD",
    country: "ID",
    allow_save_payment_method: "DISABLED",
    allowed_payment_channels: ["CARDS"],
    description: input.description.slice(0, 1000),
    customer: {
      reference_id: input.customerReferenceId.replace(/[^A-Za-z0-9]/g, "").slice(0, 64),
      type: "INDIVIDUAL",
      email: input.payerEmail,
      ...(input.payerPhone ? { mobile_number: input.payerPhone } : {}),
      individual_detail: {
        given_names: cleanName(input.payerFirstName, "Customer"),
        surname: cleanName(input.payerLastName, "BookingVIP"),
      },
    },
    success_return_url: input.successRedirectUrl,
    failure_return_url: input.failureRedirectUrl,
    cancel_return_url: input.failureRedirectUrl,
  });

  if (!payload.payment_session_id) {
    throw new Error("Xendit did not return a payment session id.");
  }

  return {
    providerRef: payload.payment_session_id,
    status: mapGatewayStatus(payload.status),
    amountCents: Math.round((payload.amount ?? amount) * 100),
    currency: "USD",
    checkoutUrl: payload.payment_link_url ?? undefined,
    expiresAt: payload.expires_at
      ? new Date(payload.expires_at)
      : new Date(Date.now() + SESSION_TTL_MS),
    raw: payload,
  };
}

/** Read a payment session back from Xendit by its id. */
export async function getCardSession(sessionId: string): Promise<XenditSession> {
  return xenditFetch<XenditSession>(
    "GET",
    `/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/**
 * Verify the `x-callback-token` header of an incoming webhook against the
 * configured verification token. Constant-time comparison; a missing
 * configuration or header never verifies.
 */
export function verifyWebhookToken(headerValue: string | null): boolean {
  const expected = process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN?.trim();
  if (!expected || !headerValue) return false;
  const a = Buffer.from(headerValue.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The URL the customer comes back to after paying. */
export function successUrl(bookingCode: string): string {
  return `${appUrl()}/payment/return?code=${encodeURIComponent(bookingCode)}`;
}

/** The URL the customer comes back to when the payment fails or is cancelled. */
export function failureUrl(bookingCode: string): string {
  return (
    `${appUrl()}/payment/return?code=${encodeURIComponent(bookingCode)}&status=failed`
  );
}

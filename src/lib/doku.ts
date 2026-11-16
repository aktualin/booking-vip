import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * The DOKU gateway (non-SNAP).
 *
 * Two channels are integrated:
 *
 *   - Credit Card via the Card Payment Page
 *     (`POST /credit-card/v1/payment-page`) — the card form lives on DOKU's
 *     hosted page, so raw card data never touches this server (no PCI scope).
 *   - QRIS via DOKU Checkout (`POST /checkout/v1/payment`) restricted to the
 *     QRIS channel — the QR code is displayed on DOKU's hosted page.
 *
 * Every request is signed with the non-SNAP HMAC-SHA256 signature:
 *
 *   Client-Id:<id>\nRequest-Id:<id>\nRequest-Timestamp:<ts>\n
 *   Request-Target:<path>[\nDigest:<base64 sha256 of the body>]
 *
 * The Digest component only exists for POST requests. Notifications coming
 * from DOKU are verified with the same formula, where Request-Target is the
 * path of our own webhook URL.
 *
 * Credentials live in the environment only — nothing is stored in the
 * database:
 *
 *   DOKU_BRAND_ID    the Client-Id (BRN-…) from the DOKU dashboard
 *   DOKU_SECRET_KEY  the shared secret used for the HMAC signature
 *   DOKU_ENV         "sandbox" (default) or "production"
 *
 * Amounts are IDR integers without decimals — not cents.
 */

/** The DOKU statuses we care about, mapped onto ours. */
export type GatewayStatus =
  | "pending"
  | "requires_action"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled";

/** A normalized payment as returned by the gateway. */
export type GatewayPayment = {
  /** Our invoice number — DOKU's identifier for the transaction. */
  providerRef: string;
  status: GatewayStatus;
  /** The amount charged, in the provider currency (cents). */
  amountCents: number;
  currency: string;
  /** Where the customer has to go to pay. */
  checkoutUrl?: string;
  /** DOKU JS session id (card) — present only when DOKU JS is activated. */
  sessionId?: string;
  expiresAt?: Date;
  /** The raw provider payload — stored on the payment for auditing. */
  raw: unknown;
};

/** The shape of a DOKU HTTP notification / check-status response. */
export type DokuTransaction = {
  service?: { id?: string; name?: string };
  acquirer?: { id?: string; name?: string };
  channel?: { id?: string; name?: string };
  order?: { invoice_number?: string; amount?: number; currency?: string };
  transaction?: {
    status?: string;
    type?: string;
    date?: string;
    original_request_id?: string;
  };
  customer?: { id?: string; name?: string; email?: string; phone?: string };
  card_payment?: {
    masked_card_number?: string;
    approval_code?: string;
    response_code?: string;
    response_message?: string;
    issuer?: string;
    brand?: string;
  };
  emoney_payment?: { account_id?: string; approval_code?: string };
  additional_info?: Record<string, unknown>;
};

/** Is the DOKU gateway configured? */
export function isDokuConfigured(): boolean {
  return Boolean(
    process.env.DOKU_BRAND_ID?.trim() && process.env.DOKU_SECRET_KEY?.trim(),
  );
}

function clientId(): string {
  const id = process.env.DOKU_BRAND_ID?.trim();
  if (!id) throw new Error("DOKU_BRAND_ID is not configured.");
  return id;
}

function secretKey(): string {
  const key = process.env.DOKU_SECRET_KEY?.trim();
  if (!key) throw new Error("DOKU_SECRET_KEY is not configured.");
  return key;
}

/** The API base URL — sandbox unless DOKU_ENV says production. */
function apiBase(): string {
  const env = process.env.DOKU_ENV?.trim().toLowerCase();
  return env === "production" || env === "live"
    ? "https://api.doku.com"
    : "https://api-sandbox.doku.com";
}

/** The public base URL of this deployment — used for the redirect URLs. */
function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * An optional per-request notification URL override. When set, it is sent as
 * `additional_info.override_notification_url` so DOKU notifies this URL
 * instead of the one configured in the dashboard — handy while the tunnel
 * URL changes during local development.
 */
function notificationUrlOverride(): string | undefined {
  const url = process.env.DOKU_NOTIFICATION_URL?.trim();
  return url ? url : undefined;
}

/** Map a DOKU transaction status onto ours. */
export function mapGatewayStatus(status: string | undefined): GatewayStatus {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESS":
      return "paid";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    case "REFUNDED":
    case "VOIDED":
      return "cancelled";
    case "PENDING":
      return "pending";
    case "REDIRECT":
    case "TIMEOUT":
      return "requires_action";
    default:
      return "pending";
  }
}

/** UTC timestamp in the ISO8601 `YYYY-MM-DDTHH:mm:ssZ` form DOKU expects. */
function requestTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** base64(SHA-256(body)) — the Digest component of the signature. */
function digestOf(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("base64");
}

/** The raw signature string, one component per line, no trailing newline. */
function signatureComponents(params: {
  clientId: string;
  requestId: string;
  timestamp: string;
  target: string;
  digest?: string;
}): string {
  const lines = [
    `Client-Id:${params.clientId}`,
    `Request-Id:${params.requestId}`,
    `Request-Timestamp:${params.timestamp}`,
    `Request-Target:${params.target}`,
  ];
  if (params.digest !== undefined) lines.push(`Digest:${params.digest}`);
  return lines.join("\n");
}

/** HMAC-SHA256 base64, prefixed with `HMACSHA256=`. */
function hmacSignature(components: string): string {
  const mac = createHmac("sha256", secretKey())
    .update(components, "utf8")
    .digest("base64");
  return `HMACSHA256=${mac}`;
}

/** Perform a signed DOKU API call. */
async function dokuFetch<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? "GET";
  const id = clientId();
  const requestId = randomUUID();
  const timestamp = requestTimestamp();
  const bodyText =
    method === "POST" && init.body !== undefined
      ? JSON.stringify(init.body)
      : undefined;

  const signature = hmacSignature(
    signatureComponents({
      clientId: id,
      requestId,
      timestamp,
      target: path,
      digest: bodyText !== undefined ? digestOf(bodyText) : undefined,
    }),
  );

  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      "Client-Id": id,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      Signature: signature,
      ...(bodyText !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: bodyText,
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const p = payload as {
      error_messages?: string[];
      errors?: { message?: string };
      message?: string[] | string;
    };
    const message =
      p.error_messages?.join("; ") ??
      p.errors?.message ??
      (Array.isArray(p.message) ? p.message.join("; ") : p.message) ??
      `DOKU request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

/** The redirect URL the customer comes back to after paying. */
export function successRedirectUrl(bookingCode: string): string {
  return `${appUrl()}/payment/return?code=${encodeURIComponent(bookingCode)}`;
}

/** The redirect URL the customer comes back to when the payment fails. */
export function failureRedirectUrl(bookingCode: string): string {
  return `${appUrl()}/payment/return?code=${encodeURIComponent(bookingCode)}&status=failed`;
}

export type CreatePaymentInput = {
  /**
   * The DOKU invoice number — max 30 characters when the Credit Card channel
   * is involved. Our `#INV/YYYY/MM/DD/NNNN/XX` format is 24 characters.
   */
  invoiceNumber: string;
  /** The amount in IDR, integer without decimals. */
  amountIdr: number;
  payerEmail: string;
  payerName?: string;
  description: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
};

/**
 * DOKU embeds the invoice number raw into the payment page URL. Our invoice
 * format starts with `#`, which the browser would parse as the URL fragment
 * — the hosted page would then read an empty invoice and hang on its loading
 * screen. Percent-encode any `#` so the invoice stays in the query string.
 */
function sanitizePaymentUrl(url: string): string {
  return url.replace(/#/g, "%23");
}

/** How long a Card Payment Page URL stays usable. */
const CARD_PAGE_TTL_MS = 60 * 60 * 1000; // 1 hour, per DOKU docs

/**
 * Create a Credit Card payment page (SALE) and return its URL.
 *
 * The customer enters the card on DOKU's hosted page; 3DS and the result
 * redirect are handled there.
 */
export async function createCardPaymentPage(
  input: CreatePaymentInput,
): Promise<GatewayPayment> {
  const override = notificationUrlOverride();
  const body: Record<string, unknown> = {
    order: {
      invoice_number: input.invoiceNumber,
      amount: input.amountIdr,
      callback_url: input.successRedirectUrl,
      failed_url: input.failureRedirectUrl,
      auto_redirect: true,
    },
    payment: { type: "SALE" },
    customer: {
      email: input.payerEmail,
      ...(input.payerName ? { name: input.payerName } : {}),
    },
    ...(override
      ? { additional_info: { override_notification_url: override } }
      : {}),
  };

  const payload = await dokuFetch<{
    order?: { invoice_number?: string };
    credit_card_payment_page?: { url?: string };
    credit_card_js?: { session_id?: string };
    errors?: { code?: string; message?: string };
  }>("/credit-card/v1/payment-page", { method: "POST", body });

  const url = payload.credit_card_payment_page?.url;
  if (!url) {
    throw new Error(
      payload.errors?.message ??
        "DOKU did not return a card payment page URL.",
    );
  }

  return {
    providerRef: payload.order?.invoice_number ?? input.invoiceNumber,
    status: "pending",
    amountCents: input.amountIdr * 100,
    currency: "IDR",
    checkoutUrl: sanitizePaymentUrl(url),
    // Only returned when the merchant has DOKU JS activated; lets the card
    // form be embedded on our own page instead of redirecting to DOKU.
    sessionId: payload.credit_card_js?.session_id,
    expiresAt: new Date(Date.now() + CARD_PAGE_TTL_MS),
    raw: payload,
  };
}

/**
 * The DOKU JS SDK URL for the current environment. The browser loads this to
 * render an embedded card form (DOKU JS). Environment-specific — never use the
 * sandbox SDK in production.
 */
export function dokuCardSdkUrl(): string {
  const env = process.env.DOKU_ENV?.trim().toLowerCase();
  return env === "production" || env === "live"
    ? "https://app.doku.com/card-session/card-session-2.0.0.js"
    : "https://sandbox.doku.com/card-session/card-session-2.0.0.js";
}

/** The QRIS checkout page lifetime, in minutes. */
export const QRIS_DUE_MINUTES = 60;

/** Parse DOKU's `yyyyMMddHHmmss` (UTC+7) expiry into a Date. */
function parseDokuExpiry(value: string | undefined): Date | undefined {
  if (!value || !/^\d{14}$/.test(value)) return undefined;
  const iso =
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
    `T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+07:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Create a DOKU Checkout page restricted to QRIS and return its URL.
 *
 * The dynamic QR code is generated and displayed by DOKU on the checkout
 * page; the customer scans it with any QRIS-capable app.
 */
export async function createQrisCheckout(
  input: CreatePaymentInput,
): Promise<GatewayPayment> {
  const override = notificationUrlOverride();
  const body: Record<string, unknown> = {
    order: {
      invoice_number: input.invoiceNumber,
      amount: input.amountIdr,
      callback_url: input.successRedirectUrl,
      callback_url_result: input.successRedirectUrl,
      auto_redirect: true,
      line_items: [
        {
          id: input.invoiceNumber,
          name: input.description.slice(0, 255),
          quantity: 1,
          price: input.amountIdr,
        },
      ],
    },
    payment: {
      payment_due_date: QRIS_DUE_MINUTES,
      payment_method_types: ["QRIS"],
    },
    customer: {
      email: input.payerEmail,
      ...(input.payerName ? { name: input.payerName } : {}),
    },
    ...(override
      ? { additional_info: { override_notification_url: override } }
      : {}),
  };

  const payload = await dokuFetch<{
    message?: string[];
    error_messages?: string[];
    response?: {
      order?: { invoice_number?: string };
      payment?: { url?: string; expired_date?: string };
    };
  }>("/checkout/v1/payment", { method: "POST", body });

  const url = payload.response?.payment?.url;
  if (!url) {
    throw new Error(
      payload.error_messages?.join("; ") ??
        "DOKU did not return a checkout URL.",
    );
  }

  return {
    providerRef:
      payload.response?.order?.invoice_number ?? input.invoiceNumber,
    status: "pending",
    amountCents: input.amountIdr * 100,
    currency: "IDR",
    checkoutUrl: sanitizePaymentUrl(url),
    expiresAt:
      parseDokuExpiry(payload.response?.payment?.expired_date) ??
      new Date(Date.now() + QRIS_DUE_MINUTES * 60 * 1000),
    raw: payload,
  };
}

/**
 * Read a transaction back from DOKU by its invoice number.
 *
 * DOKU asks to wait ~60 seconds after payment completion before the status
 * is final; a PENDING answer here simply means "not yet".
 */
export async function checkStatus(
  invoiceNumber: string,
): Promise<DokuTransaction> {
  return dokuFetch<DokuTransaction>(
    `/orders/v1/status/${encodeURIComponent(invoiceNumber)}`,
  );
}

// ---------------------------------------------------------------------------
// Host-to-Host card flow — the card form lives on OUR page
// ---------------------------------------------------------------------------

/** The card details for the 3DS check. Raw card data — never logged or stored. */
export type DirectCardInput = {
  invoiceNumber: string;
  amountIdr: number;
  /** Card number, digits only (13–19). */
  cardNumber: string;
  /** Card expiry as MMYY, e.g. "0131". */
  cardExpiry: string;
  customer: { name?: string; email: string; phone?: string };
  /** Our own URLs DOKU redirects the customer to after the 3DS step. */
  successUrl: string;
  failureUrl: string;
};

/** A 3DS session returned by the Check 3DS API. */
export type ThreeDSecureSession = {
  authenticationId: string;
  authenticationUrl: string;
};

/**
 * Check 3D Secure (Host-to-Host) — step 1 of the embedded card flow.
 *
 * The customer enters the card on OUR page; the server asks DOKU to start the
 * 3DS authentication and gets back the authentication page the customer must
 * visit (issuer OTP or frictionless approval). The card number and expiry are
 * used for this one request only — they are never persisted or logged.
 */
export async function checkThreeDSecure(
  input: DirectCardInput,
): Promise<ThreeDSecureSession> {
  const body: Record<string, unknown> = {
    customer: {
      ...(input.customer.name ? { name: input.customer.name } : {}),
      email: input.customer.email,
      ...(input.customer.phone ? { phone: input.customer.phone } : {}),
    },
    order: {
      amount: input.amountIdr,
      invoice_number: input.invoiceNumber,
    },
    card: {
      number: input.cardNumber,
      expiry: input.cardExpiry,
    },
    payment: { type: "SALE" },
    three_dsecure: {
      callback_url_success: input.successUrl,
      callback_url_failed: input.failureUrl,
    },
  };

  const payload = await dokuFetch<{
    three_dsecure?: { authentication_id?: string; authentication_url?: string };
    error?: { message?: string };
  }>("/credit-card/check-three-d-secure", { method: "POST", body });

  const authenticationId = payload.three_dsecure?.authentication_id;
  const authenticationUrl = payload.three_dsecure?.authentication_url;
  if (!authenticationId || !authenticationUrl) {
    throw new Error(
      payload.error?.message ?? "DOKU did not return a 3DS session.",
    );
  }

  return { authenticationId, authenticationUrl };
}

/**
 * Charge (Host-to-Host) — step 3, after the customer completed the 3DS
 * authentication. The CVV comes from the short-lived in-memory vault, so it
 * is never stored anywhere durable.
 */
export async function chargeCard(input: {
  invoiceNumber: string;
  amountIdr: number;
  customer: { name?: string; email: string; phone?: string };
  authenticationId: string;
  cvv: string;
}): Promise<GatewayPayment> {
  const body: Record<string, unknown> = {
    order: {
      amount: input.amountIdr,
      invoice_number: input.invoiceNumber,
    },
    customer: {
      ...(input.customer.name ? { name: input.customer.name } : {}),
      email: input.customer.email,
      ...(input.customer.phone ? { phone: input.customer.phone } : {}),
    },
    three_dsecure: { authentication_id: input.authenticationId },
    payment: { type: "SALE" },
    card: { cvv: input.cvv, save: false },
  };

  const payload = await dokuFetch<{
    order?: { invoice_number?: string; amount?: number };
    payment?: { status?: string; response_code?: string; response_message?: string };
    errors?: { message?: string };
  }>("/credit-card/charge", { method: "POST", body });

  // A declined card is HTTP 200 with payment.status FAILED — surface it as a
  // failed GatewayPayment instead of throwing.
  return {
    providerRef: payload.order?.invoice_number ?? input.invoiceNumber,
    status: mapGatewayStatus(payload.payment?.status),
    amountCents: input.amountIdr * 100,
    currency: "IDR",
    raw: payload,
  };
}

/**
 * Verify the signature of an incoming DOKU notification.
 *
 * The Request-Target is the path of our webhook URL; the Digest is computed
 * from the raw body exactly as received.
 */
export function verifyNotificationSignature(params: {
  headers: Headers;
  rawBody: string;
  path: string;
}): boolean {
  if (!isDokuConfigured()) return false;

  const got = params.headers.get("signature")?.trim();
  const id = params.headers.get("client-id")?.trim();
  const requestId = params.headers.get("request-id")?.trim();
  const timestamp = params.headers.get("request-timestamp")?.trim();
  if (!got || !id || !requestId || !timestamp) return false;
  if (id !== clientId()) return false;

  const expected = hmacSignature(
    signatureComponents({
      clientId: id,
      requestId,
      timestamp,
      target: params.path,
      digest: digestOf(params.rawBody),
    }),
  );

  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
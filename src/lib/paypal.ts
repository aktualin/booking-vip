import "server-only";

/**
 * The PayPal gateway — Orders API (v2) with MANUAL capture.
 *
 * The second payment provider next to Xendit. The model is the classic
 * redirect checkout:
 *
 *   1. the server creates an order (`intent: CAPTURE`, USD) and hands the
 *      customer the `approve` link;
 *   2. the customer logs into PayPal and approves the order there;
 *   3. PayPal redirects back to /payment/return and/or fires the
 *      CHECKOUT.ORDER.APPROVED webhook;
 *   4. the server CAPTURES the order itself (return-page refresh or
 *      webhook) — the money only moves after our own capture call;
 *   5. CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.COMPLETED webhooks act as
 *      the reliable confirmation path.
 *
 * Manual capture (instead of auto-capture on approve) keeps the server in
 * control of the amount check, mirroring the Xendit flow where the money
 * only counts once the gateway tells us the exact charged amount.
 *
 * Unlike Xendit (which charges IDR), PayPal charges USD natively — the
 * booking total is used as-is, `fxRate` stays 1 and no conversion happens.
 *
 * Authentication is OAuth2 client-credentials: the REST credentials from
 * the developer dashboard are exchanged for an access token (valid ~9h),
 * cached module-level and refreshed shortly before expiry.
 *
 * Credentials live in the environment only:
 *
 *   PAYPAL_MODE        "sandbox" (default) | "live"
 *   PAYPAL_API_KEY     the REST app client id
 *   PAYPAL_API_SECRET  the REST app secret
 */

/** The gateway statuses we care about, mapped onto ours (same set as Xendit). */
export type GatewayStatus =
  | "pending"
  | "requires_action"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled";

/** A HATEOAS link PayPal puts on every resource (`rel: "approve"` etc.). */
export type PayPalLink = {
  href: string;
  rel: string;
  method?: string;
};

/** PayPal money — a currency code plus a decimal STRING ("100.00"). */
export type PayPalMoney = {
  currency_code?: string;
  value?: string;
};

/** One capture inside a purchase unit's payments. */
export type PayPalCapture = {
  id?: string;
  status?: string;
  amount?: PayPalMoney;
  create_time?: string;
  update_time?: string;
};

/** A purchase unit — our invoice + custom ids live here. */
export type PayPalPurchaseUnit = {
  reference_id?: string;
  custom_id?: string;
  invoice_id?: string;
  description?: string;
  amount?: PayPalMoney;
  payments?: {
    captures?: PayPalCapture[];
    refunds?: unknown[];
  };
};

/** The shape of a PayPal order (create / get / capture / webhook resource). */
export type PayPalOrder = {
  id?: string;
  status?: string;
  intent?: string;
  payment_source?: Record<string, unknown>;
  purchase_units?: PayPalPurchaseUnit[];
  payer?: {
    email_address?: string;
    name?: { given_name?: string; surname?: string };
  };
  create_time?: string;
  update_time?: string;
  links?: PayPalLink[];
};

/**
 * The shape of a PAYMENT.CAPTURE.* webhook resource — a capture object,
 * correlated back to its order via `supplementary_data.related_ids`.
 */
export type PayPalCaptureResource = PayPalCapture & {
  custom_id?: string;
  invoice_id?: string;
  supplementary_data?: {
    related_ids?: { order_id?: string; authorization_id?: string };
  };
};

/** The webhook envelope — every event type shares this shape. */
export type PayPalWebhook = {
  id?: string;
  event_version?: string;
  event_type?: string;
  summary?: string;
  resource_type?: string;
  resource_version?: string;
  create_time?: string;
  resource?: PayPalOrder & PayPalCaptureResource;
  links?: PayPalLink[];
};

/** A normalized payment as returned by the gateway (mirrors xendit.ts). */
export type PayPalGatewayPayment = {
  /** The PayPal order id — our provider reference. */
  providerRef: string;
  status: GatewayStatus;
  /** The amount charged, in USD cents. */
  amountCents: number;
  currency: "USD";
  /** Where the customer has to go to approve the order. */
  checkoutUrl?: string;
  expiresAt?: Date;
  /** The raw provider payload — stored on the payment for auditing. */
  raw: unknown;
};

/** The money + customer + redirect parameters for a new order. */
export type PayPalOrderInput = {
  /** Our invoice number — PayPal's `invoice_id` (max 127 chars). */
  invoiceId: string;
  /** The booking id — PayPal's `custom_id` (max 127 chars). */
  customId: string;
  /** Order description (max 127 chars). */
  description: string;
  /** The server-computed booking total in USD cents. */
  amountUsdCents: number;
  payerEmail?: string;
  payerFirstName?: string;
  payerLastName?: string;
  returnUrl: string;
  cancelUrl: string;
};

/** A PayPal API error that carries the machine-readable issue code. */
export class PayPalError extends Error {
  /** e.g. "ORDER_ALREADY_CAPTURED", "INVALID_REQUEST". */
  readonly issue: string;
  /** The HTTP status of the failed call. */
  readonly status: number;

  constructor(message: string, issue = "", status = 0) {
    super(message);
    this.name = "PayPalError";
    this.issue = issue;
    this.status = status;
  }
}

/** Is the PayPal gateway configured? */
export function isPayPalConfigured(): boolean {
  return Boolean(
    process.env.PAYPAL_API_KEY?.trim() && process.env.PAYPAL_API_SECRET?.trim(),
  );
}

/** sandbox (default) or live. */
function isLive(): boolean {
  return (process.env.PAYPAL_MODE ?? "sandbox").trim().toLowerCase() === "live";
}

/** The REST base URL of the configured mode. */
export function baseUrl(): string {
  return isLive() ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function credentials(): { clientId: string; secret: string } {
  const clientId = process.env.PAYPAL_API_KEY?.trim();
  const secret = process.env.PAYPAL_API_SECRET?.trim();
  if (!clientId || !secret) {
    throw new Error("PAYPAL_API_KEY / PAYPAL_API_SECRET are not configured.");
  }
  return { clientId, secret };
}

/** The module-level access-token cache. */
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * The OAuth2 access token — fetched with client credentials and cached
 * until 60s before its expiry (PayPal tokens live ~9 hours).
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const { clientId, secret } = credentials();
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const response = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new PayPalError(
      `PayPal token request failed with status ${response.status}: ${text.slice(0, 200)}`,
      "TOKEN_ERROR",
      response.status,
    );
  }

  let json: { access_token?: string; expires_in?: number } = {};
  try {
    json = JSON.parse(text);
  } catch {
    throw new PayPalError("PayPal token response was not valid JSON.", "TOKEN_ERROR", response.status);
  }
  if (!json.access_token) {
    throw new PayPalError("PayPal did not return an access token.", "TOKEN_ERROR", response.status);
  }

  cachedToken = {
    token: json.access_token,
    // Refresh a minute early so an in-flight request never uses a dead token.
    expiresAt: Date.now() + Math.max(60, json.expires_in ?? 32400) * 1000 - 60_000,
  };
  return cachedToken.token;
}

/** Perform a Bearer-auth PayPal REST call. */
async function payPalFetch<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body — fall through to the status error below.
  }

  if (!response.ok) {
    const err = json as
      | {
          name?: string;
          message?: string;
          details?: { issue?: string; description?: string }[];
        }
      | null;
    // The SPECIFIC machine-readable code lives in details[0].issue (e.g.
    // INSTRUMENT_DECLINED, ORDER_NOT_APPROVED); the top-level `name` is the
    // coarse family (UNPROCESSABLE_ENTITY, INVALID_RESOURCE_ID). Prefer the
    // specific one — callers classify on it.
    const issue = err?.details?.[0]?.issue || err?.name || "";
    const detail = err?.details
      ?.map((d) => d.issue ?? d.description)
      .filter(Boolean)
      .join(", ");
    throw new PayPalError(
      [err?.message ?? `PayPal request failed with status ${response.status}`, detail]
        .filter(Boolean)
        .join(" — "),
      issue,
      response.status,
    );
  }

  return json as T;
}

/** USD cents → PayPal decimal string ("12345" → "123.45"). */
export function usdCentsToValue(cents: number): string {
  return (Math.max(1, Math.round(cents)) / 100).toFixed(2);
}

/** PayPal decimal string → USD cents ("123.45" → 12345). */
export function valueToUsdCents(value: string | undefined | null): number | undefined {
  if (value == null) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

/** Map a PayPal ORDER status onto ours. */
export function mapPayPalOrderStatus(status: string | undefined): GatewayStatus {
  switch ((status ?? "").toUpperCase()) {
    case "COMPLETED":
      return "paid";
    case "APPROVED":
    case "PAYER_ACTION_REQUIRED":
      return "requires_action";
    case "VOIDED":
      return "cancelled";
    case "CREATED":
    case "SAVED":
    case "PENDING_APPROVAL":
    default:
      return "pending";
  }
}

/** Map a PayPal CAPTURE status onto ours. */
export function mapPayPalCaptureStatus(status: string | undefined): GatewayStatus {
  switch ((status ?? "").toUpperCase()) {
    case "COMPLETED":
      // A refunded capture was paid once — the refund is tracked separately.
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "paid";
    case "DECLINED":
    case "DENIED":
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    case "PENDING":
    default:
      return "pending";
  }
}

/** The capture of an order (the last one), normalized. */
export function extractCapture(order: PayPalOrder): {
  captureId?: string;
  status: GatewayStatus;
  rawStatus: string;
  amountCents?: number;
  currency?: string;
} | null {
  const captures = order.purchase_units?.[0]?.payments?.captures;
  if (!captures || captures.length === 0) return null;
  const capture = captures[captures.length - 1];
  return {
    captureId: capture.id,
    status: mapPayPalCaptureStatus(capture.status),
    rawStatus: capture.status ?? "",
    amountCents: valueToUsdCents(capture.amount?.value),
    currency: capture.amount?.currency_code,
  };
}

/** The ordered amount of an order in USD cents. */
export function orderAmountCents(order: PayPalOrder): number | undefined {
  return valueToUsdCents(order.purchase_units?.[0]?.amount?.value);
}

/**
 * The overall status of an order: the capture status when a capture exists
 * (that is the money movement), the order status otherwise.
 */
export function orderGatewayStatus(order: PayPalOrder): GatewayStatus {
  const capture = extractCapture(order);
  if (capture) return capture.status;
  return mapPayPalOrderStatus(order.status);
}

/** The `approve` (or `payer-action`) link the customer is redirected to. */
export function approveLink(order: PayPalOrder): string | undefined {
  const link = order.links?.find(
    (l) => l.rel === "approve" || l.rel === "payer-action",
  );
  return link?.href;
}

/**
 * The order lifetime we rely on. PayPal keeps a created order approvable
 * for up to 72h; we expire our attempt after 24h like the Xendit session.
 */
export const ORDER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Create a USD order with manual capture and return its approve URL.
 *
 * `invoiceId` is our invoice number (surfaces on the PayPal receipt),
 * `customId` is the booking id — both come back on the capture webhook and
 * are how we correlate events to payments.
 */
export async function createOrder(
  input: PayPalOrderInput,
): Promise<PayPalGatewayPayment> {
  const value = usdCentsToValue(input.amountUsdCents);

  // NOTE: the `payer` object is deliberately NOT sent even though the input
  // carries the contact's name/email. Pre-seeding a payer email makes PayPal
  // treat the payer as identified (the order comes back PAYER_ACTION_REQUIRED
  // and the checkout can pin the login to that account) — and the booking
  // contact email is often not the customer's PayPal email. On the redirect
  // checkout the payer identifies themselves; the fields stay available for
  // future server-side use (notifications, order records).
  const order = await payPalFetch<PayPalOrder>("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: input.customId.slice(0, 127),
        invoice_id: input.invoiceId.slice(0, 127),
        description: input.description.slice(0, 127),
        amount: { currency_code: "USD", value },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Booking VIP",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
    },
  });

  if (!order.id) {
    throw new Error("PayPal did not return an order id.");
  }

  return {
    providerRef: order.id,
    status: mapPayPalOrderStatus(order.status),
    amountCents: valueToUsdCents(value) ?? input.amountUsdCents,
    currency: "USD",
    checkoutUrl: approveLink(order),
    expiresAt: new Date(Date.now() + ORDER_TTL_MS),
    raw: order,
  };
}

/** Read an order back from PayPal by its id. */
export async function getOrder(orderId: string): Promise<PayPalOrder> {
  return payPalFetch<PayPalOrder>(
    "GET",
    `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
  );
}

/**
 * Capture an approved order — the moment the money moves.
 *
 * Capturing an already-captured order is a 422 (ORDER_ALREADY_CAPTURED);
 * that is not an error for us, so the order is simply read back. This makes
 * the return-page capture and the webhook capture safe to race.
 */
export async function captureOrder(orderId: string): Promise<PayPalOrder> {
  try {
    return await payPalFetch<PayPalOrder>(
      "POST",
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {},
    );
  } catch (error) {
    if (
      error instanceof PayPalError &&
      (error.issue === "ORDER_ALREADY_CAPTURED" ||
        error.issue === "ORDER_ALREADY_COMPLETED")
    ) {
      return getOrder(orderId);
    }
    throw error;
  }
}

/** The public base URL of this deployment — used for the redirect URLs. */
function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** The URL the customer comes back to after approving on PayPal. */
export function successUrl(bookingCode: string): string {
  return `${appUrl()}/payment/return?code=${encodeURIComponent(bookingCode)}`;
}

/** The URL the customer comes back to when the payment is cancelled. */
export function failureUrl(bookingCode: string): string {
  return `${appUrl()}/payment/return?code=${encodeURIComponent(bookingCode)}&status=failed`;
}

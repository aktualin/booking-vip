import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * The Xendit gateway — Payments API (v3), Payment Sessions.
 *
 * Three channels are integrated, all through a hosted PAYMENT_LINK session:
 * Credit Card, QRIS and Virtual Account (bank transfer). The server creates
 * a session and the customer is redirected to Xendit's hosted checkout page
 * (`payment_link_url`), where the card form / QR code / VA number live — raw
 * card data never touches this server (PCI SAQ A).
 *
 * Prices are stored and displayed in USD. Xendit charges in IDR, so the
 * server converts the booking total (USD cents) to whole rupiah at session
 * creation (see `src/lib/fx.ts` — Frankfurter API with a fallback) and
 * creates the session with `currency: "IDR"`. The rate used and the IDR
 * amount are frozen on the payment row. The customer-facing display stays
 * USD everywhere; the conversion is server-side plumbing.
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

/** The payment channels we start sessions for (PaymentMethod.providerMethodCode). */
export type PaymentChannel = "CREDIT_CARD" | "QRIS" | "VIRTUAL_ACCOUNT";

/**
 * The Virtual Account bank channels offered on the hosted checkout page.
 * Channel codes per the Xendit channel documentation (all support Payment
 * Link); BCA is the default when a single bank is requested.
 */
export const VA_CHANNEL_CODES = [
  "BCA_VIRTUAL_ACCOUNT",
  "MANDIRI_VIRTUAL_ACCOUNT",
  "BNI_VIRTUAL_ACCOUNT",
  "BRI_VIRTUAL_ACCOUNT",
  "BSI_VIRTUAL_ACCOUNT",
  "PERMATA_VIRTUAL_ACCOUNT",
] as const;

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
  /** The amount charged, in IDR cents (whole rupiah × 100). */
  amountCents: number;
  currency: "IDR";
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

/**
 * Legacy card-event fields (credit_card.authentication / .capture /
 * .tokenization). The tokenization test delivery (dashboard → Cards
 * tokenization → test) carries the masked card fields at the top level of
 * `data` plus `card_info`; we never tokenize or store cards ourselves, so
 * these are informational only.
 */
export type XenditLegacyEvent = {
  id?: string;
  external_id?: string;
  card_data?: {
    masked_card_number?: string;
    exp_month?: string;
    exp_year?: string;
  };
  masked_card_number?: string;
  card_expiration_month?: string;
  card_expiration_year?: string;
  card_info?: {
    bank?: string;
    country?: string;
    type?: string;
    brand?: string;
    fingerprint?: string;
  };
  eci?: string;
  three_ds_result?: string;
  three_ds_version?: string;
};

/**
 * The channel-level payment events of QRIS (`qr.payment`) and Virtual
 * Account (`va.payment`). Unlike the v3 session/payment events these arrive
 * FLAT (no `data` envelope): the fields sit at the top level of the body.
 * QRIS nests the merchant reference in `qr_code.external_id`; VA carries
 * `external_id` directly. Both use our invoice number as the reference.
 */
export type XenditChannelPaymentEvent = {
  id?: string;
  payment_id?: string;
  external_id?: string;
  reference_id?: string;
  amount?: number;
  status?: string;
  currency?: string;
  bank_code?: string;
  qr_code?: { id?: string; external_id?: string };
};

/** The webhook envelope — session-level, payment-level and legacy events. */
export type XenditWebhook = {
  event?: string;
  business_id?: string;
  created?: string;
  api_version?: string | null;
  data?: XenditSession & XenditPaymentEvent & XenditLegacyEvent;
} & XenditChannelPaymentEvent;

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
    case "CAPTURED":
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
    case "VERIFIED":
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
 * The session lifetime we enforce: the customer has 5 minutes to pay on the
 * hosted page. Sent to Xendit as `expires_at` so the gateway expires the
 * session itself; the `expires_at` in the response stays authoritative.
 */
export const SESSION_TTL_MS = 5 * 60 * 1000;

/** Sanitize a name for Xendit's alphanumeric-only customer fields. */
function cleanName(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 50);
  return cleaned || fallback;
}

/** The money + customer + redirect parameters shared by every channel. */
export type PaymentSessionInput = {
  referenceId: string;
  amountIdr: number;
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
};

/**
 * Create a PAYMENT_LINK session in IDR for one of our channels and return
 * its hosted checkout URL.
 *
 * The customer pays on Xendit's hosted page — the card form + 3DS for
 * CREDIT_CARD, the scannable QR for QRIS, the VA number + instructions for
 * VIRTUAL_ACCOUNT. `referenceId` is our invoice number (max 64 chars).
 * `amountIdr` is the whole-rupiah amount the server converted from the USD
 * total — Xendit IDR amounts are integers without decimals.
 *
 * Channel selection uses `allowed_payment_channels` (the Sessions API has
 * no per-request `payment_method` object — that shape belongs to the
 * Payment Requests API). QRIS uses the documented channel code "QRIS";
 * Virtual Account offers the six documented Indonesian VA bank channels
 * (BCA first) so the customer picks the bank on the hosted page.
 */
export async function createPaymentSession(
  input: PaymentSessionInput & {
    channel: PaymentChannel;
    /** Override the VA bank channels (defaults to all six, BCA first). */
    vaChannelCodes?: string[];
  },
): Promise<GatewayPayment> {
  const amount = Math.max(1, Math.round(input.amountIdr));

  const allowedChannels =
    input.channel === "CREDIT_CARD"
      ? ["CARDS"]
      : input.channel === "QRIS"
        ? ["QRIS"]
        : input.vaChannelCodes && input.vaChannelCodes.length > 0
          ? input.vaChannelCodes
          : [...VA_CHANNEL_CODES];

  const payload = await xenditFetch<XenditSession>("POST", "/sessions", {
    reference_id: input.referenceId.slice(0, 64),
    session_type: "PAY",
    mode: "PAYMENT_LINK",
    amount,
    currency: "IDR",
    country: "ID",
    allow_save_payment_method: "DISABLED",
    allowed_payment_channels: allowedChannels,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
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
    currency: "IDR",
    checkoutUrl: payload.payment_link_url ?? undefined,
    expiresAt: payload.expires_at
      ? new Date(payload.expires_at)
      : new Date(Date.now() + SESSION_TTL_MS),
    raw: payload,
  };
}

/**
 * Create a card PAYMENT_LINK session — the original entry point, kept as a
 * thin wrapper over `createPaymentSession`.
 */
export async function createCardSession(
  input: PaymentSessionInput,
): Promise<GatewayPayment> {
  return createPaymentSession({ ...input, channel: "CREDIT_CARD" });
}

/** Read a payment session back from Xendit by its id. */
export async function getCardSession(sessionId: string): Promise<XenditSession> {
  return xenditFetch<XenditSession>(
    "GET",
    `/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/* ------------------------------------------------------------------------- */
/* Cards — server-side tokenization + token charge (Payments API v3)         */
/* ------------------------------------------------------------------------- */

/**
 * The saved-card path: the server tokenizes the stored card together with
 * the CVV the customer typed (`POST /v3/payment_tokens`) and charges the
 * token with a PAY payment request. Raw card data therefore transits this
 * server in memory only — the CVV is never stored, and the PAN rests in the
 * `SavedCard` row encrypted (AES-256-GCM).
 *
 * Both calls can answer REQUIRES_ACTION: the `actions` array then carries
 * the 3DS redirect URL the customer has to finish in the browser.
 */

export type XenditAction = {
  type?: string;
  descriptor?: string;
  value?: string;
};

/** The answer of `POST /v3/payment_tokens`. */
export type XenditPaymentToken = {
  payment_token_id?: string;
  status?: string;
  actions?: XenditAction[];
  failure_code?: string;
  masked_card_number?: string;
  channel_properties?: unknown;
};

/** The answer of `POST /v3/payment_requests` / `GET /v3/payment_requests/{id}`. */
export type XenditPaymentRequest = {
  payment_request_id?: string;
  reference_id?: string;
  status?: string;
  actions?: XenditAction[];
  request_amount?: number;
  currency?: string;
  failure_code?: string;
};

/** The redirect URL of a REQUIRES_ACTION answer, when the gateway gives one. */
export function redirectActionUrl(actions: XenditAction[] | undefined): string | null {
  const action = (actions ?? []).find(
    (entry) =>
      entry.type === "REDIRECT_CUSTOMER" &&
      entry.descriptor === "WEB_URL" &&
      typeof entry.value === "string" &&
      entry.value.startsWith("http"),
  );
  return action?.value ?? null;
}

export type CardTokenInput = {
  referenceId: string;
  cardNumber: string;
  cvv: string;
  expMonth: number;
  expYear: number;
  payerEmail: string;
  payerFirstName: string;
  payerLastName: string;
  payerPhone?: string;
  customerReferenceId: string;
  successReturnUrl: string;
  failureReturnUrl: string;
};

/** Tokenize a card server-side — the token is single-use for one charge. */
export async function createCardPaymentToken(
  input: CardTokenInput,
): Promise<XenditPaymentToken> {
  return xenditFetch<XenditPaymentToken>("POST", "/v3/payment_tokens", {
    reference_id: input.referenceId.slice(0, 255),
    country: "ID",
    currency: "IDR",
    channel_code: "CARDS",
    channel_properties: {
      card_details: {
        card_number: input.cardNumber,
        cvn: input.cvv,
        expiry_month: String(input.expMonth).padStart(2, "0"),
        expiry_year: String(input.expYear),
        cardholder_first_name: cleanName(input.payerFirstName, "Customer"),
        cardholder_last_name: cleanName(input.payerLastName, "BookingVIP"),
        cardholder_email: input.payerEmail,
        ...(input.payerPhone ? { cardholder_phone_number: input.payerPhone } : {}),
      },
      skip_three_ds: false,
      success_return_url: input.successReturnUrl,
      failure_return_url: input.failureReturnUrl,
    },
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
    description: `Saved card tokenization ${input.referenceId}`.slice(0, 1000),
  });
}

export type TokenPaymentInput = {
  referenceId: string;
  paymentTokenId: string;
  amountIdr: number;
  description: string;
  successReturnUrl: string;
  failureReturnUrl: string;
};

/** Charge a saved-card token — a customer-unscheduled card-on-file payment. */
export async function createTokenPayment(
  input: TokenPaymentInput,
): Promise<XenditPaymentRequest> {
  return xenditFetch<XenditPaymentRequest>("POST", "/v3/payment_requests", {
    reference_id: input.referenceId.slice(0, 255),
    payment_token_id: input.paymentTokenId,
    type: "PAY",
    country: "ID",
    currency: "IDR",
    request_amount: Math.max(1, Math.round(input.amountIdr)),
    capture_method: "AUTOMATIC",
    channel_properties: {
      card_on_file_type: "CUSTOMER_UNSCHEDULED",
      skip_three_ds: false,
      success_return_url: input.successReturnUrl,
      failure_return_url: input.failureReturnUrl,
    },
    description: input.description.slice(0, 1000),
  });
}

/** Read a payment request back — the status refresh of a token charge. */
export async function getPaymentRequest(
  paymentRequestId: string,
): Promise<XenditPaymentRequest> {
  return xenditFetch<XenditPaymentRequest>(
    "GET",
    `/v3/payment_requests/${encodeURIComponent(paymentRequestId)}`,
  );
}

/** Read a payment token back — the status refresh of a tokenization. */
export async function getPaymentToken(
  paymentTokenId: string,
): Promise<XenditPaymentToken> {
  return xenditFetch<XenditPaymentToken>(
    "GET",
    `/v3/payment_tokens/${encodeURIComponent(paymentTokenId)}`,
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

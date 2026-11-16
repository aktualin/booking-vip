"use server";

import {
  getPaymentStatus,
  startCardDirectPayment,
  startPayment,
} from "@/lib/payments";

/**
 * The customer-facing payment actions.
 *
 * They are thin wrappers around `src/lib/payments.ts` so the browser can
 * never talk to the gateway directly.
 */

export type StartPaymentResult =
  | {
      ok: true;
      checkoutUrl: string;
      paymentId: string;
      channel: "CREDIT_CARD" | "QRIS";
      /** DOKU JS session id — when set, the card form can be embedded on our
       *  own page; when null, fall back to the DOKU hosted page. */
      sessionId: string | null;
      cardSdkUrl: string | null;
    }
  | { ok: false; error: string };

/** Create the gateway invoice and return the checkout URL. */
export async function startBookingPayment(params: {
  bookingCode: string;
  email: string;
  methodCode: string;
}): Promise<StartPaymentResult> {
  try {
    const result = await startPayment(params);
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      checkoutUrl: result.checkoutUrl,
      paymentId: result.paymentId,
      channel: result.channel,
      sessionId: result.sessionId,
      cardSdkUrl: result.cardSdkUrl,
    };
  } catch (error) {
    console.error("[payments] could not start the payment", error);
    return {
      ok: false,
      error: "Pembayaran tidak bisa dimulai. Coba lagi sebentar.",
    };
  }
}

export type CardPaymentResult =
  | { ok: true; authenticationUrl: string }
  | { ok: false; error: string };

/**
 * Start a direct (Host-to-Host) card payment: the card was entered on OUR
 * page, the server starts the 3DS authentication and returns the URL the
 * browser must redirect to. The card data is used for the DOKU call only —
 * it is never stored.
 */
export async function startCardDirectBookingPayment(params: {
  bookingCode: string;
  email: string;
  cardNumber: string;
  /** MMYY, e.g. "0131". */
  cardExpiry: string;
  cardCvv: string;
}): Promise<CardPaymentResult> {
  try {
    const result = await startCardDirectPayment(params);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, authenticationUrl: result.authenticationUrl };
  } catch (error) {
    console.error("[payments] could not start the card payment", (error as Error).message);
    return { ok: false, error: "Pembayaran kartu tidak bisa dimulai. Coba lagi." };
  }
}

export type PaymentStatusResult =
  | {
      ok: true;
      status: string;
      bookingStatus: string;
      amountUsdCents: number;
      checkoutUrl: string | null;
    }
  | { ok: false; error: string };

/** The status of a booking's payment — polled by the return page. */
export async function getBookingPaymentStatus(params: {
  bookingCode: string;
  email: string;
}): Promise<PaymentStatusResult> {
  try {
    return await getPaymentStatus(params);
  } catch (error) {
    console.error("[payments] could not read the payment status", error);
    return { ok: false, error: "Status pembayaran tidak bisa dibaca." };
  }
}

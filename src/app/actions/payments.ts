"use server";

import {
  getPaymentStatus,
  startPayment,
  startSavedCardPayment,
  getPaymentPageData,
  type PaymentPageData,
  type SavedCardPaymentResult,
} from "@/lib/payments";
import { getUserSession } from "@/lib/user/session";
import { db } from "@/prisma/db";

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
    }
  | { ok: false; error: string };

/**
 * Create the Xendit payment session for the chosen method (CREDIT_CARD,
 * QRIS or BANK_TRANSFER / Virtual Account) and return the hosted checkout
 * URL. Every channel uses the same redirect model — the customer pays on
 * Xendit's page and comes back via /payment/return.
 */
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
    };
  } catch (error) {
    console.error("[payments] could not start the payment", error);
    return {
      ok: false,
      error: "Pembayaran tidak bisa dimulai. Coba lagi sebentar.",
    };
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

/**
 * Charge one of the signed-in customer's saved cards — the CVV-only path.
 *
 * The card must belong to the session user; the CVV travels to the gateway
 * tokenization and is never stored. See `startSavedCardPayment` for the
 * 3DS / pending semantics of the result.
 */
export async function payWithSavedCard(params: {
  bookingCode: string;
  email: string;
  cardId: string;
  cvv: string;
}): Promise<SavedCardPaymentResult> {
  const session = await getUserSession();
  if (!session) return { ok: false, error: "Masuk terlebih dahulu untuk memakai kartu tersimpan." };

  const cards = await db.orm.public.SavedCard
    .select("id")
    .where((f) => f.id.eq(params.cardId))
    .where((f) => f.userId.eq(session.uid))
    .limit(1)
    .all();
  if (cards.length === 0) return { ok: false, error: "Kartu tidak ditemukan di akun Anda." };

  try {
    return await startSavedCardPayment(params);
  } catch (error) {
    console.error("[payments] saved-card payment failed", error);
    return { ok: false, error: "Pembayaran tidak bisa dimulai. Coba lagi sebentar." };
  }
}

export type PaymentPageDataResult =
  | { ok: true; data: PaymentPageData }
  | { ok: false; error: string };

/** The waiting / success page payload — polled by the waiting page. */
export async function getPaymentPageDataAction(params: {
  bookingCode: string;
  email: string;
}): Promise<PaymentPageDataResult> {
  try {
    return await getPaymentPageData(params);
  } catch (error) {
    console.error("[payments] could not read the payment page data", error);
    return { ok: false, error: "Data pembayaran tidak bisa dibaca." };
  }
}

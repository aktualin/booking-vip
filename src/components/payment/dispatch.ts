"use client";

// The client-side dispatch of a checkout intent: a gateway method starts a
// hosted checkout session; a saved card runs the CVV-only token charge.
// Both answers carry the URL the browser has to open next — the gateway
// page, the 3DS page, the waiting page or the success page.

import { payWithSavedCard, startBookingPayment } from "@/app/actions/payments";
import type { PayIntent } from "./PaymentForm";

export type DispatchResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string };

const LAST_BOOKING_KEY = "booking-vip:last-booking";

/** Remember the booking so the return page can find the email again. */
export function rememberBooking(code: string, email: string): void {
  try {
    localStorage.setItem(LAST_BOOKING_KEY, JSON.stringify({ code, email }));
  } catch {
    // Storage unavailable — the return page asks for the email.
  }
}

export async function dispatchPayIntent(
  intent: PayIntent,
  params: { bookingCode: string; email: string },
): Promise<DispatchResult> {
  const { bookingCode, email } = params;

  if (intent.kind === "method") {
    const result = await startBookingPayment({
      bookingCode,
      email,
      methodCode: intent.methodCode,
    });
    if (!result.ok) return { ok: false, error: result.error };
    rememberBooking(bookingCode, email);
    return { ok: true, redirectUrl: result.checkoutUrl };
  }

  const result = await payWithSavedCard({
    bookingCode,
    email,
    cardId: intent.cardId,
    cvv: intent.cvv,
  });
  if (!result.ok) return { ok: false, error: result.error };
  rememberBooking(bookingCode, email);

  if (result.status === "paid") {
    return {
      ok: true,
      redirectUrl: `/payment/success/${encodeURIComponent(bookingCode)}`,
    };
  }
  if (result.status === "requires_action") {
    return { ok: true, redirectUrl: result.redirectUrl };
  }
  return {
    ok: true,
    redirectUrl: `/payment/return?code=${encodeURIComponent(bookingCode)}`,
  };
}

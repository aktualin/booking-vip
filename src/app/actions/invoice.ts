"use server";

import { getInvoiceByCodeAndEmail } from "@/lib/invoice";
import type { InvoiceDTO } from "@/lib/invoice";

/**
 * The guest invoice action.
 *
 * Ownership is proven by the booking code plus the contact email — the same
 * rule as `getBookingByCode` / `startPayment`. A miss and an unexpected error
 * return the same generic message, so nothing leaks about which codes exist.
 */

export type GuestInvoiceResult =
  | { ok: true; invoice: InvoiceDTO }
  | { ok: false; error: string };

/** The invoice of a guest booking (code + contact email). */
export async function getGuestInvoice(
  code: string,
  email: string,
): Promise<GuestInvoiceResult> {
  try {
    const invoice = await getInvoiceByCodeAndEmail(code, email);
    if (!invoice) return { ok: false, error: "Invoice tidak ditemukan." };
    return { ok: true, invoice };
  } catch (error) {
    console.error("[invoice] could not load the guest invoice", error);
    return { ok: false, error: "Invoice tidak ditemukan." };
  }
}
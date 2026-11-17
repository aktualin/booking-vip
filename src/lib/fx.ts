import "server-only";

/**
 * The server-side USD→IDR conversion for the payment gateway.
 *
 * Prices are stored and displayed in USD. Xendit charges Indonesian cards
 * in IDR, so at the moment a payment session is created the booking total
 * (USD cents) is converted to whole rupiah with the live rate. The rate used
 * is frozen on the payment row (`fxRate`) next to the IDR amount
 * (`providerAmountCents`, `providerCurrency`) — the charge and its snapshot
 * can never disagree.
 *
 * Rate source: the public Frankfurter API (ECB reference rates), with a
 * hard-coded fallback so a booking never fails because of a rate.
 */

/** The fallback rate — used when the API is unreachable. */
const FALLBACK_RATE = 16500;

/**
 * How many rupiah one US dollar is worth right now.
 *
 * Always a positive number; never throws.
 */
export async function getUsdToIdrRate(): Promise<number> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(
      "https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR",
      { signal: ctrl.signal, cache: "no-store" },
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`fx ${res.status}`);

    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = json.rates?.IDR;
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      return rate;
    }
  } catch {
    // Network failure — the fallback below keeps the flow alive.
  }

  return FALLBACK_RATE;
}

/**
 * Convert an amount in USD cents into whole rupiah (Xendit IDR amounts are
 * integers without decimals). Rounded to the nearest rupiah, minimum 1.
 */
export function convertUsdCentsToIdr(usdCents: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return Math.max(1, Math.round(usdCents / 100));
  return Math.max(1, Math.round((usdCents / 100) * rate));
}

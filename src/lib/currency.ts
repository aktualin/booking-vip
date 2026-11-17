// USD-only price formatting.
//
// All prices in the app are USD — stored as integer cents in the data layer
// and passed here as dollars (e.g. cents / 100). This module only formats
// them for display; no conversion exists anywhere in the app.

export type CurrencyCode = "USD";

/** Format a USD amount (in dollars) for display, e.g. `$85.00`. */
export function formatMoneyWith(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}
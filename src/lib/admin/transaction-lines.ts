/**
 * The service lines of the admin transaction area.
 *
 * Four of these are real `ServiceLine` rows (verified against the database:
 * `transport`, `tour-package`, `vip-service`, `evoa`). "fast-track" is NOT a
 * service line — it is a `ServiceType` under `vip-service`; the transaction
 * area exposes it as its own scoped view (bookings whose items are products
 * of the vip-service line with the fast-track type). The resolution lives in
 * `src/app/actions/admin-bookings.ts`.
 *
 * Plain module (no server-only import) so the sidebar, the pages and the
 * actions all share one list.
 */

export type TransactionLine = {
  /** The route slug under /admin/transactions — also the line scope key. */
  slug: string;
  /** The display name of the menu / page. */
  name: string;
};

export const TRANSACTION_LINES: readonly TransactionLine[] = [
  { slug: "transport", name: "Transport" },
  { slug: "tour-package", name: "Tour Package" },
  { slug: "fast-track", name: "Fast Track" },
  { slug: "vip-service", name: "Airport VIP Service" },
  { slug: "evoa", name: "eVOA" },
];

/** Where the transactions index redirects — the first menu entry. */
export const FIRST_TRANSACTION_LINE = TRANSACTION_LINES[0]!.slug;

/** The display name of a line scope (falls back to the slug). */
export function transactionLineName(slug: string): string {
  return TRANSACTION_LINES.find((line) => line.slug === slug)?.name ?? slug;
}

import { Suspense } from "react";
import { connection } from "next/server";
import {
  getAdminTransactionStats,
  listAdminBookings,
} from "@/app/actions/admin-bookings";
import TransactionsManager from "./TransactionsManager";
import { adminClass } from "@/components/admin/tokens";

/**
 * The server half of a transaction line page.
 *
 * The request-time read (session-gated stats + the first page of bookings)
 * lives in `TransactionsLineData`, wrapped in a `<Suspense>` boundary HERE — in
 * the page segment. The admin layout's boundary persists across navigations
 * within `/admin`, so it cannot stream a page-level read; without a boundary in
 * the page itself, Cache Components reports "uncached data during a navigation"
 * and the navigation is not instant. With this boundary the shell + fallback
 * render immediately and the data streams in.
 */
export default function TransactionsLinePage({
  lineSlug,
  lineName,
}: {
  lineSlug: string;
  lineName: string;
}) {
  return (
    <Suspense fallback={<TransactionsFallback />}>
      <TransactionsLineData lineSlug={lineSlug} lineName={lineName} />
    </Suspense>
  );
}

/** Fallback shown while the stats and the first page load. */
function TransactionsFallback() {
  return (
    <div
      className={`${adminClass.panel} px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]`}
    >
      Memuat transaksi…
    </div>
  );
}

/**
 * Loads the stats and the first page through the admin actions (both are
 * assertAdmin-gated) and hands them to the client manager as initial data.
 * `connection()` marks the read as request-time; it is legal under Cache
 * Components because this component renders inside the Suspense boundary above.
 */
async function TransactionsLineData({
  lineSlug,
  lineName,
}: {
  lineSlug: string;
  lineName: string;
}) {
  await connection();

  const [stats, list] = await Promise.all([
    getAdminTransactionStats(lineSlug),
    listAdminBookings({ lineSlug, page: 1, pageSize: 5 }),
  ]);

  return (
    <TransactionsManager
      lineSlug={lineSlug}
      lineName={lineName}
      initialStats={stats}
      initialRows={list.rows}
      initialTotal={list.total}
    />
  );
}

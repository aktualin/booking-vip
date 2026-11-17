import { connection } from "next/server";
import {
  getAdminTransactionStats,
  listAdminBookings,
} from "@/app/actions/admin-bookings";
import TransactionsManager from "./TransactionsManager";

/**
 * The server half of a transaction line page.
 *
 * Loads the stats and the first page through the admin actions (both are
 * assertAdmin-gated) and hands them to the client manager as initial data.
 * `connection()` marks the read as request-time; the component renders
 * inside the admin layout's Suspense guard, so the cookie read is legal
 * under Cache Components.
 */
export default async function TransactionsLinePage({
  lineSlug,
  lineName,
}: {
  lineSlug: string;
  lineName: string;
}) {
  await connection();

  const [stats, list] = await Promise.all([
    getAdminTransactionStats(lineSlug),
    listAdminBookings({ lineSlug, page: 1, pageSize: 20 }),
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

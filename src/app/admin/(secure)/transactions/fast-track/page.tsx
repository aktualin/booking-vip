import type { Metadata } from "next";
import TransactionsLinePage from "@/components/admin/TransactionsLinePage";
import { transactionLineName } from "@/lib/admin/transaction-lines";

export const metadata: Metadata = {
  title: "Transaksi Fast Track · Admin",
  robots: { index: false, follow: false },
};

/**
 * Fast Track is a ServiceType under the vip-service line, not a ServiceLine
 * of its own — the action resolves this scope to the fast-track products of
 * the vip-service line.
 */
export default function AdminFastTrackTransactionsPage() {
  return <TransactionsLinePage lineSlug="fast-track" lineName={transactionLineName("fast-track")} />;
}

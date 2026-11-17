import type { Metadata } from "next";
import TransactionsLinePage from "@/components/admin/TransactionsLinePage";
import { transactionLineName } from "@/lib/admin/transaction-lines";

export const metadata: Metadata = {
  title: "Transaksi Airport VIP Service · Admin",
  robots: { index: false, follow: false },
};

/** The real line slug is "vip-service" (Airport VIP Service). */
export default function AdminVipServiceTransactionsPage() {
  return <TransactionsLinePage lineSlug="vip-service" lineName={transactionLineName("vip-service")} />;
}

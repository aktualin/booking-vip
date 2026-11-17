import type { Metadata } from "next";
import TransactionsLinePage from "@/components/admin/TransactionsLinePage";
import { transactionLineName } from "@/lib/admin/transaction-lines";

export const metadata: Metadata = {
  title: "Transaksi Transport · Admin",
  robots: { index: false, follow: false },
};

export default function AdminTransportTransactionsPage() {
  return <TransactionsLinePage lineSlug="transport" lineName={transactionLineName("transport")} />;
}

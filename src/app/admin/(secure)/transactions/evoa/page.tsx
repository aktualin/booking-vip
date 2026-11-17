import type { Metadata } from "next";
import TransactionsLinePage from "@/components/admin/TransactionsLinePage";
import { transactionLineName } from "@/lib/admin/transaction-lines";

export const metadata: Metadata = {
  title: "Transaksi eVOA · Admin",
  robots: { index: false, follow: false },
};

export default function AdminEvoaTransactionsPage() {
  return <TransactionsLinePage lineSlug="evoa" lineName={transactionLineName("evoa")} />;
}

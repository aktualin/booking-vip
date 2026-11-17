import type { Metadata } from "next";
import TransactionsLinePage from "@/components/admin/TransactionsLinePage";
import { transactionLineName } from "@/lib/admin/transaction-lines";

export const metadata: Metadata = {
  title: "Transaksi Tour Package · Admin",
  robots: { index: false, follow: false },
};

export default function AdminTourPackageTransactionsPage() {
  return (
    <TransactionsLinePage lineSlug="tour-package" lineName={transactionLineName("tour-package")} />
  );
}

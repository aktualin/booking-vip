import { redirect } from "next/navigation";
import { FIRST_TRANSACTION_LINE } from "@/lib/admin/transaction-lines";

/** The transactions index — straight to the first service line. */
export default function AdminTransactionsIndexPage() {
  redirect(`/admin/transactions/${FIRST_TRANSACTION_LINE}`);
}

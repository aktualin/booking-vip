import type { Metadata } from "next";
import BookingsManager from "./BookingsManager";

export const metadata: Metadata = {
  title: "Transaksi · Admin",
  robots: { index: false, follow: false },
};

/**
 * The transaction area — every booking across the service lines, with the
 * tour operations panel on the detail page. The shell stays static; the
 * client manager pulls the rows through server actions.
 */
export default function AdminBookingsPage() {
  return <BookingsManager />;
}

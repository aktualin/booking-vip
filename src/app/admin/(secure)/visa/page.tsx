import type { Metadata } from "next";
import EvoaOrdersTable from "@/components/admin/evoa/EvoaOrdersTable";

export const metadata: Metadata = {
  title: "Pengajuan e-VOA · Admin",
  robots: { index: false, follow: false },
};

/**
 * The e-VOA order list of the admin panel.
 *
 * Admin convention: the page shell stays static and the client table pulls
 * the rows through the guarded `listEvoaOrders` server action.
 */
export default function AdminVisaPage() {
  return <EvoaOrdersTable />;
}
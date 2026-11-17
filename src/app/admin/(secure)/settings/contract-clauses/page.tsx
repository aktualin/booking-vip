import type { Metadata } from "next";
import ContractClausesManager from "./ContractClausesManager";

export const metadata: Metadata = {
  title: "Pasal Perjanjian Sewa · Admin",
  robots: { index: false, follow: false },
};

/** Admin settings page for the rental agreement articles. */
export default function AdminContractClausesPage() {
  return <ContractClausesManager />;
}

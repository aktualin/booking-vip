import type { Metadata } from "next";
import VehiclesForm from "../VehiclesForm";

export const metadata: Metadata = {
  title: "Tambah Vehicle · Admin",
  robots: { index: false, follow: false },
};

export default function AdminVehiclesNewPage() {
  return <VehiclesForm mode="create" />;
}

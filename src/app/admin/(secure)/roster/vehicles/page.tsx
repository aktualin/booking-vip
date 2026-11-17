import type { Metadata } from "next";
import VehiclesManager from "./VehiclesManager";

export const metadata: Metadata = {
  title: "Vehicle · Admin",
  robots: { index: false, follow: false },
};

export default function AdminVehiclesPage() {
  return <VehiclesManager />;
}

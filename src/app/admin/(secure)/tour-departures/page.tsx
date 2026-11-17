import type { Metadata } from "next";
import DeparturesManager from "./DeparturesManager";

export const metadata: Metadata = {
  title: "Departure Tour · Admin",
  robots: { index: false, follow: false },
};

/**
 * The join-in departure schedule — per tour product, with the live seat
 * availability derived from the active bookings.
 */
export default function AdminTourDeparturesPage() {
  return <DeparturesManager />;
}

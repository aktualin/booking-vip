import type { Metadata } from "next";
import DeparturesForm from "../DeparturesForm";

export const metadata: Metadata = {
  title: "Tambah Jadwal · Admin",
  robots: { index: false, follow: false },
};

export default function AdminTourDeparturesNewPage() {
  return <DeparturesForm mode="create" />;
}

import type { Metadata } from "next";
import DriversForm from "../DriversForm";

export const metadata: Metadata = {
  title: "Tambah Driver · Admin",
  robots: { index: false, follow: false },
};

export default function AdminDriversNewPage() {
  return <DriversForm mode="create" />;
}

import type { Metadata } from "next";
import DriversManager from "./DriversManager";

export const metadata: Metadata = {
  title: "Driver · Admin",
  robots: { index: false, follow: false },
};

export default function AdminDriversPage() {
  return <DriversManager />;
}

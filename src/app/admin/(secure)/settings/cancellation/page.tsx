import type { Metadata } from "next";
import CancellationSettingsForm from "./CancellationSettingsForm";

export const metadata: Metadata = {
  title: "Pembatalan Tour · Admin",
  robots: { index: false, follow: false },
};

/** Admin settings page for the tour cancellation & refund policy. */
export default function AdminCancellationSettingsPage() {
  return <CancellationSettingsForm />;
}

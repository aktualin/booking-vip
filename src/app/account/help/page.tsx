import type { Metadata } from "next";
import HelpPanel from "@/components/account/HelpPanel";

export const metadata: Metadata = {
  title: "Bantuan · Booking VIP",
  description: "Pusat bantuan Booking VIP.",
};

/** The help centre — still being written. */
export default function AccountHelpPage() {
  return <HelpPanel />;
}

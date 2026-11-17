import type { Metadata } from "next";
import BrandingSettingsForm from "./BrandingSettingsForm";

export const metadata: Metadata = {
  title: "Branding · Admin",
  robots: { index: false, follow: false },
};

/** Admin settings page for the app name / tagline on customer documents. */
export default function AdminBrandingSettingsPage() {
  return <BrandingSettingsForm />;
}

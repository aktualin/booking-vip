import type { Metadata } from "next";
import EvoaFieldsBuilder from "@/components/admin/evoa/EvoaFieldsBuilder";

export const metadata: Metadata = {
  title: "Form Dinamis e-VOA · Admin",
  robots: { index: false, follow: false },
};

/**
 * The dynamic e-VOA form fields — extra questions the operator adds on top
 * of the standard form without a deploy. The guarded admin layout already
 * wraps this in AdminShell behind Suspense + connection(); the builder
 * loads its rows through the admin action, like the tax settings page.
 */
export default function AdminEvoaFieldsPage() {
  return <EvoaFieldsBuilder />;
}
import type { Metadata } from "next";
import SiteInfoForm from "./SiteInfoForm";

export const metadata: Metadata = {
  title: "Info Situs & Legal · Admin",
  robots: { index: false, follow: false },
};

/** The site identity, footer info and legal documents settings. */
export default function AdminSiteInfoPage() {
  return <SiteInfoForm />;
}

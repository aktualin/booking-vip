import type { Metadata } from "next";
import { Suspense } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/sections/Footer";
import BottomTabBar from "@/components/sections/BottomTabBar";
import Container from "@/components/ui/Container";
import BackToHomeLink from "@/components/sections/BackToHomeLink";
import LegalDocumentClient from "@/components/sections/LegalDocumentClient";
import { getSiteInfo } from "@/lib/site-settings";

export const metadata: Metadata = {
  title: "Kebijakan Privasi · Booking VIP",
};

/** The public Privacy Policy page — content is edited in the admin area. */
export default async function PrivacyPage() {
  const site = await getSiteInfo();

  return (
    <div className="flex min-h-screen flex-col bg-canvas pb-20 lg:pb-0">
      <Suspense>
        <Header variant="solid" />
      </Suspense>
      <main className="flex-1">
        <Container className="py-6 md:py-8">
          <BackToHomeLink />
          <div className="mx-auto max-w-3xl">
            <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">
              Kebijakan Privasi
            </h1>
            {site.companyName ? (
              <p className="mt-1 text-sm text-ink/60">{site.companyName}</p>
            ) : null}
            <div className="mt-6">
              <LegalDocumentClient html={site.privacyHtml} />
            </div>
          </div>
        </Container>
      </main>
      <Footer />
      <BottomTabBar />
    </div>
  );
}

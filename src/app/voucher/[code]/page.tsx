import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Header from "@/components/layout/Header";
import Footer from "@/components/sections/Footer";
import BottomTabBar from "@/components/sections/BottomTabBar";
import Container from "@/components/ui/Container";
import TourVoucherClient from "@/components/voucher/TourVoucherClient";

export const metadata: Metadata = {
  title: "E-Voucher Tur · Booking VIP",
  description: "E-voucher pesanan tur Booking VIP kamu.",
  robots: { index: false, follow: false },
};

/**
 * The tour e-voucher page.
 *
 * Guests prove ownership with the booking code plus the contact email
 * (taken from the query string or the browser when it matches, otherwise
 * asked for); the signed-in owner of the booking needs no email. The page
 * is print-friendly — the chrome hides itself when printing.
 */
export default function VoucherPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas pb-20 lg:pb-0">
      <div className="print:hidden">
        <Suspense>
          <Header variant="solid" />
        </Suspense>
      </div>

      <main className="flex-1">
        <Container className="py-6 md:py-10">
          <Suspense fallback={null}>
            <VoucherStep params={params} searchParams={searchParams} />
          </Suspense>
        </Container>
      </main>

      <div className="print:hidden">
        <Footer />
        <BottomTabBar />
      </div>
    </div>
  );
}

/** The dynamic part: the booking code from the path, the email from the query. */
async function VoucherStep({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  await connection();

  const { code } = await params;
  const { email } = await searchParams;

  return (
    <TourVoucherClient
      code={code.trim().toUpperCase()}
      initialEmail={email?.trim() ?? ""}
    />
  );
}
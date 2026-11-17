import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Header from "@/components/layout/Header";
import Footer from "@/components/sections/Footer";
import Container from "@/components/ui/Container";
import { getBranding } from "@/lib/branding";
import PaymentSuccess from "@/components/payment/PaymentSuccess";

export const metadata: Metadata = {
  title: "Pembayaran Berhasil · Booking VIP",
  description: "Pesanan kamu sudah dikonfirmasi.",
  robots: { index: false, follow: false },
};

/**
 * The thank-you page — the Shopify-style order confirmation: the customer
 * and payment details on the left, the itemised total and the brand mark on
 * the right.
 */
export default function PaymentSuccessPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Suspense>
        <Header variant="solid" />
      </Suspense>

      <main className="flex-1">
        <Container className="py-8 md:py-12">
          <Suspense fallback={null}>
            <SuccessStep params={params} />
          </Suspense>
        </Container>
      </main>

      <Footer />
    </div>
  );
}

/** The dynamic part: the booking code plus the configured branding. */
async function SuccessStep({ params }: { params: Promise<{ code: string }> }) {
  await connection();

  const { code } = await params;
  const brand = await getBranding();

  return <PaymentSuccess code={code.toUpperCase()} brand={brand} />;
}

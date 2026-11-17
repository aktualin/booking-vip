import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Header from "@/components/layout/Header";
import Footer from "@/components/sections/Footer";
import Container from "@/components/ui/Container";
import PaymentPageClient from "@/components/payment/PaymentPageClient";

export const metadata: Metadata = {
  title: "Pembayaran · Booking VIP",
  description: "Selesaikan pembayaran pesanan Booking VIP kamu.",
  robots: { index: false, follow: false },
};

/**
 * The standalone checkout page of an existing, unpaid booking.
 *
 * It is the retry entry point (order list, waiting page) AND the place a
 * failed gateway return lands on — `?status=failed` renders the checkout
 * banner above the payment form.
 */
export default function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Suspense>
        <Header variant="solid" />
      </Suspense>

      <main className="flex-1">
        <Container className="py-8 md:py-12">
          <Suspense fallback={null}>
            <PayStep params={params} searchParams={searchParams} />
          </Suspense>
        </Container>
      </main>

      <Footer />
    </div>
  );
}

/** The dynamic part: the booking code and the return status. */
async function PayStep({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  await connection();

  const { code } = await params;
  const query = await searchParams;
  const status = query.status === "failed" || query.status === "expired" ? query.status : null;

  return <PaymentPageClient code={code.toUpperCase()} initialStatus={status} />;
}

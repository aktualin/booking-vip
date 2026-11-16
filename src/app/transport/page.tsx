import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import Header from "@/components/layout/Header";
import Footer from "@/components/sections/Footer";
import BottomTabBar from "@/components/sections/BottomTabBar";
import Container from "@/components/ui/Container";
import BackToHomeLink from "@/components/sections/BackToHomeLink";
import TransportSearchClient from "@/components/transport/TransportSearchClient";
import { getOptions } from "@/app/actions/catalog";

export const metadata: Metadata = {
  title: "Sewa Mobil · Booking VIP",
  description:
    "Sewa mobil dengan supir atau tanpa supir. Pilih tanggal, opsi supir, dan bandingkan armadanya.",
};

/**
 * The transport entry page — "Sewa Mobil".
 *
 * The navbar points here: the customer picks the dates, the driver option and
 * the car class before the fleet is shown. The fleet itself lives on
 * `/transport/armada`.
 */
export default function TransportPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white pb-20 lg:pb-0">
      <Suspense>
        <Header variant="solid" />
      </Suspense>

      <main className="flex-1">
        {/* Hero band */}
        <section className="bg-gradient-to-b from-hero-from via-hero-via to-hero-to py-10 md:py-14">
          <Container>
            <BackToHomeLink />
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/60">
              Transport
            </p>
            <h1 className="mt-1 text-3xl font-extrabold text-white md:text-4xl">
              Sewa Mobil
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-white/85 md:text-base">
              Sewa mobil dari berbagai mitra — dengan supir atau lepas kunci.
              Pilih tanggal, opsi supir, dan bandingkan armadanya.
            </p>
          </Container>
        </section>

        <Container className="py-8 md:py-12">
          <Suspense fallback={<SearchSkeleton />}>
            <TransportSearchStep />
          </Suspense>
        </Container>
      </main>

      <Footer />
      <BottomTabBar />
    </div>
  );
}

/** The skeleton shown while the vehicle classes load. */
function SearchSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-64 rounded-2xl border border-line bg-white" />
      <div className="h-80 rounded-2xl border border-line bg-white" />
    </div>
  );
}

/**
 * The dynamic part of the page: the vehicle classes.
 *
 * They come from the database, so the page is rendered at request time.
 */
async function TransportSearchStep() {
  await connection();

  const types = await getOptions("serviceType", "transport");

  return (
    <TransportSearchClient
      vehicleTypes={types.map((t) => ({ slug: t.value, name: t.label }))}
    />
  );
}

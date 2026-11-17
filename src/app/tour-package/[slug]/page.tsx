import type { Metadata } from "next";
import { Suspense } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/sections/Footer";
import BottomTabBar from "@/components/sections/BottomTabBar";
import TourDetailClient from "@/components/tour/TourDetailClient";

export const metadata: Metadata = {
  title: "Tour Package Details - Booking VIP",
};

export default function TourPackageDetailPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white pb-20 lg:pb-0">
      <Suspense>
        <Header variant="solid" />
      </Suspense>
      <main className="flex-1">
        <Suspense>
          <TourDetailClient />
        </Suspense>
      </main>
      <Footer />
      <BottomTabBar />
    </div>
  );
}

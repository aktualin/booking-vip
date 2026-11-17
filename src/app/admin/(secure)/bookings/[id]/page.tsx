import { Suspense } from "react";
import type { Metadata } from "next";
import BookingDetailManager from "./BookingDetailManager";

export const metadata: Metadata = {
  title: "Detail Transaksi · Admin",
  robots: { index: false, follow: false },
};

/**
 * The transaction detail page. The id comes from the URL, so it is read
 * inside a `<Suspense>` boundary (Cache Components rule — same pattern as
 * the catalog edit pages).
 */
export default function AdminBookingDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<DetailFallback />}>
      <BookingDetailLoader {...props} />
    </Suspense>
  );
}

async function BookingDetailLoader(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <BookingDetailManager id={id} />;
}

function DetailFallback() {
  return (
    <div className="rounded-lg border border-[var(--admin-line)] px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]">
      Memuat data…
    </div>
  );
}

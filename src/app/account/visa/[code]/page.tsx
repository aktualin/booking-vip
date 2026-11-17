import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import AccountPageHeader from "@/components/account/AccountPageHeader";
import EvoaTrackingPanel from "@/components/account/evoa/EvoaTrackingPanel";
import { getEvoaTracking } from "@/app/actions/evoa-tracking";

export const metadata: Metadata = {
  title: "Lacak e-VOA · Booking VIP",
  description: "Pantau status pengajuan e-VOA kamu — dokumen, revisi, dan visa terbit.",
};

/**
 * The customer's e-VOA tracking page.
 *
 * Lives inside the account area, so the layout already provides the site
 * header / footer, the container and the signed-in gate. The dynamic part
 * (the order lookup, which reads the session cookie) is isolated behind its
 * own Suspense boundary with `await connection()` — the cacheComponents
 * pattern used across the app.
 */
export default function VisaTrackingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <div>
      <AccountPageHeader
        title="Lacak e-VOA"
        description="Pantau status pengajuan visa kamu — dokumen, revisi, dan visa yang terbit."
        backHref="/account/orders"
        backLabel="Kembali ke Pesanan"
      />

      <Suspense
        fallback={
          <p className="px-5 py-10 text-center text-[13px] text-muted">Memuat…</p>
        }
      >
        <TrackingSection params={params} />
      </Suspense>
    </div>
  );
}

/** The order lookup — null when the code is unknown or not owned. */
async function TrackingSection({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();

  const { code } = await params;
  const tracking = await getEvoaTracking(code);

  if (!tracking) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-8 text-center">
        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
          Pengajuan tidak ditemukan
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Nomor pengajuan tidak ada atau bukan milik akun kamu. Periksa lagi
          nomornya di halaman Pesanan.
        </p>
        <Link
          href="/account/orders"
          className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand px-6 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
        >
          Kembali ke Pesanan
        </Link>
      </div>
    );
  }

  return <EvoaTrackingPanel tracking={tracking} />;
}
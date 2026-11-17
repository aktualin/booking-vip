import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { getUserSession } from "@/lib/user/session";
import { getMyOrderTracking } from "@/app/actions/order-tracking";
import VipTracking from "@/components/booking/VipTracking";

export const metadata: Metadata = {
  title: "Lacak Pesanan · Booking VIP",
  description: "Lacak status pengurusan dokumen dan layanan Airport VIP.",
};

/**
 * The tracking page of one order in the account area.
 *
 * Ownership is proven by the session (see `getMyOrderTracking`). The page
 * shows a compact summary plus the VIP document-handling timeline; for
 * non-VIP orders the timeline renders nothing and the summary stands alone.
 *
 * The dynamic part (the session read plus the order lookup) is isolated
 * behind its own Suspense boundary with `await connection()` — the
 * cacheComponents pattern used across the app (see the e-VOA tracking page).
 */
export default function OrderTrackingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <Link
          href="/account/orders"
          className="text-[12px] font-medium text-muted transition-colors hover:text-ink"
        >
          ← Kembali ke pesanan
        </Link>
      </div>

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

/** The session check and the order lookup — dynamic, streamed in. */
async function TrackingSection({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();

  const { code } = await params;
  const session = await getUserSession();

  if (!session) {
    return (
      <div className="rounded-2xl border border-line bg-white p-10 text-center">
        <h1 className="text-[18px] font-bold text-ink">Sesi tidak valid</h1>
        <p className="mt-2 text-[13px] text-muted">
          Silakan masuk kembali untuk melacak pesanan.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[13px] font-semibold text-white"
        >
          Masuk
        </Link>
      </div>
    );
  }

  const result = await getMyOrderTracking(code);

  if (!result.found) {
    return (
      <div className="rounded-2xl border border-line bg-white p-10 text-center">
        <h1 className="text-[18px] font-bold text-ink">Pesanan tidak ditemukan</h1>
        <p className="mt-2 text-[13px] text-muted">
          Pesanan ini tidak ada atau bukan milik akun kamu.
        </p>
        <Link
          href="/account/orders"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[13px] font-semibold text-white"
        >
          Kembali ke pesanan
        </Link>
      </div>
    );
  }

  const booking = result.booking;

  return (
    <>
      <div className="mb-6 rounded-2xl border border-line bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <p className="text-xs text-muted">Kode booking</p>
            <p className="font-mono text-lg font-bold text-ink">{booking.code}</p>
          </div>
          <Link
            href={`/account/orders/${encodeURIComponent(booking.code)}/invoice`}
            className="text-[12px] font-semibold text-brand transition-opacity hover:opacity-80"
          >
            Unduh invoice
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4 text-sm">
          <div>
            <p className="text-muted">Tanggal layanan</p>
            <p className="font-semibold text-ink">
              {new Date(booking.serviceAt).toLocaleDateString("id-ID", {
                weekday: "short",
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          <div>
            <p className="text-muted">Total</p>
            <p className="font-semibold text-brand">
              ${(booking.totalUsd).toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <VipTracking booking={booking} />
    </>
  );
}

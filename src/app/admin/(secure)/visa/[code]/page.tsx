import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { getEvoaOrderAdmin } from "@/app/actions/evoa-admin";
import EvoaOrderDetail from "@/components/admin/evoa/EvoaOrderDetail";

export const metadata: Metadata = {
  title: "Detail e-VOA · Admin",
  robots: { index: false, follow: false },
};

/**
 * The admin detail page of one e-VOA order.
 *
 * With Cache Components enabled the URL read and the database load happen
 * inside a `<Suspense>` boundary behind `connection()` — the same pattern as
 * the customer apply page — so the shell stays instant and the order data
 * streams in per request.
 */
export default function AdminVisaDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <Suspense fallback={<VisaDetailFallback />}>
      <VisaDetailSection params={params} />
    </Suspense>
  );
}

async function VisaDetailSection({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();

  const { code } = await params;
  const order = await getEvoaOrderAdmin(code);

  if (!order) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-8 text-center">
        <h1 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
          Pengajuan tidak ditemukan
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Kode <span className="font-mono font-semibold">{code}</span> tidak
          terdaftar, atau sesi admin kamu sudah berakhir.
        </p>
        <Link
          href="/admin/visa"
          className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand px-6 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Kembali ke daftar
        </Link>
      </div>
    );
  }

  return <EvoaOrderDetail order={order} />;
}

function VisaDetailFallback() {
  return (
    <div className="rounded-2xl border border-line bg-white px-6 py-12 text-center text-[13px] text-muted">
      Memuat pengajuan…
    </div>
  );
}
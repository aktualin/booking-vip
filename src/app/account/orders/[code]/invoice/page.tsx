import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getUserSession } from "@/lib/user/session";
import { getMyInvoice } from "@/app/actions/account";
import PrintInvoiceButton from "@/components/account/PrintInvoiceButton";
import InvoiceSheet from "@/components/invoice/InvoiceSheet";

export const metadata: Metadata = {
  title: "Invoice · Booking VIP",
  description: "Invoice Booking VIP.",
};

/**
 * The printable invoice of one booking.
 *
 * The page is deliberately plain: a white sheet with thin borders, so
 * "Print → Save as PDF" produces a clean document.
 *
 * The session + invoice read is request-time, so it lives in `InvoiceContent`
 * behind a page-level `<Suspense>` boundary — the account layout's boundary
 * persists across navigations and cannot stream a page-level read, so without
 * this the navigation is not instant under Cache Components.
 */
export default function InvoicePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <Suspense fallback={<InvoiceSkeleton />}>
      <InvoiceContent params={params} />
    </Suspense>
  );
}

/** Fallback shown while the session and invoice load. */
function InvoiceSkeleton() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="h-72 animate-pulse rounded-2xl bg-white" />
    </div>
  );
}

async function InvoiceContent({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();

  const { code } = await params;
  const session = await getUserSession();

  if (!session) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-10 text-center">
        <h1 className="text-[18px] font-bold text-ink">Sesi tidak valid</h1>
        <p className="mt-2 text-[13px] text-muted">
          Silakan masuk kembali untuk membuka invoice.
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

  const invoice = await getMyInvoice(code);

  if (!invoice) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-10 text-center">
        <h1 className="text-[18px] font-bold text-ink">Invoice tidak ditemukan</h1>
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

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link
          href="/account/orders"
          className="text-[12px] font-medium text-muted transition-colors hover:text-ink"
        >
          ← Kembali ke pesanan
        </Link>
        <PrintInvoiceButton />
      </div>

      <InvoiceSheet invoice={invoice} />
    </div>
  );
}
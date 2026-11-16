import type { Metadata } from "next";
import Link from "next/link";
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
 */
export default async function InvoicePage({
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
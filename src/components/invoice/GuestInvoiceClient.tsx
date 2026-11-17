"use client";

import { useCallback, useEffect, useState } from "react";
import { getGuestInvoice } from "@/app/actions/invoice";
import type { InvoiceDTO } from "@/lib/invoice";
import type { BrandInfo } from "@/lib/branding";
import InvoiceSheet from "@/components/invoice/InvoiceSheet";
import PrintInvoiceButton from "@/components/account/PrintInvoiceButton";

/**
 * The guest invoice flow.
 *
 * The email that proves the ownership comes from the browser (it was stored
 * when the booking was made) when the code matches; otherwise it is asked
 * for — the same pattern as the payment return page.
 */

const LAST_BOOKING_KEY = "booking-vip:last-booking";

export default function GuestInvoiceClient({
  code,
  brand = null,
}: {
  code: string;
  brand?: BrandInfo | null;
}) {
  const [email, setEmail] = useState("");
  const [invoice, setInvoice] = useState<InvoiceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (address: string) => {
      setLoading(true);
      setError(null);

      const result = await getGuestInvoice(code, address);
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }

      setInvoice(result.invoice);
      setLoading(false);
    },
    [code],
  );

  // Pick up the email of the last booking, then load the invoice.
  useEffect(() => {
    let cancelled = false;

    try {
      const raw = localStorage.getItem(LAST_BOOKING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { code?: string; email?: string };
        if (parsed.email && parsed.code === code) {
          if (!cancelled) {
            setEmail(parsed.email);
            void load(parsed.email);
          }
          return;
        }
      }
    } catch {
      // Storage unavailable — the email is asked for below.
    }

    if (!cancelled) setLoading(false);
  }, [code, load]);

  /* ----------------------------------------------------------------- */
  /* Invoice loaded                                                     */
  /* ----------------------------------------------------------------- */
  if (invoice) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-[12px] text-muted">
            Simpan sebagai PDF lewat tombol cetak.
          </p>
          <PrintInvoiceButton />
        </div>

        <InvoiceSheet invoice={invoice} brand={brand} />
      </div>
    );
  }

  /* ----------------------------------------------------------------- */
  /* Loading                                                            */
  /* ----------------------------------------------------------------- */
  if (loading) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            className="animate-spin text-brand-dark"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <p className="mt-4 text-[13px] text-muted">Memuat invoice…</p>
      </div>
    );
  }

  /* ----------------------------------------------------------------- */
  /* Email form (also the retry after an error)                         */
  /* ----------------------------------------------------------------- */
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center">
      <h1 className="text-[20px] font-bold tracking-[-0.01em] text-ink">
        Invoice pesanan
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        Masukkan email yang dipakai saat memesan untuk membuka invoice{" "}
        <span className="font-mono font-semibold text-ink">{code}</span>.
      </p>

      <form
        className="mt-6 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void load(email.trim());
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email yang dipakai saat memesan"
          className="h-11 flex-1 rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
        />
        <button
          type="submit"
          className="h-11 rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
        >
          Periksa
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
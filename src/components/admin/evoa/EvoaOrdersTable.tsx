"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  listEvoaOrders,
  type EvoaOrderListResult,
} from "@/app/actions/evoa-admin";
import {
  EVOA_LEGACY_STATUSES,
  EVOA_ORDER_STATUSES,
} from "@/lib/evoa-shared";
import { StatusBadge, fmtDate, fmtUsd, statusLabel } from "./EvoaOrderShared";

/**
 * The e-VOA order list of the admin panel.
 *
 * Rows are pulled through the `listEvoaOrders` server action (the admin
 * convention: the page shell stays static, the client fetches). Sorted by
 * arrival date — the nearest arrival is the most urgent, and arrivals within
 * three days are highlighted.
 */

const STATUS_OPTIONS: string[] = [...EVOA_ORDER_STATUSES, ...EVOA_LEGACY_STATUSES];

const FIELD_CLASS =
  "h-10 rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

export default function EvoaOrdersTable() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);

  const [data, setData] = useState<EvoaOrderListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    listEvoaOrders({
      status: status || undefined,
      q: q || undefined,
      page,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status, q, page, nonce]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setQ(qInput.trim());
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink">
          Pengajuan e-VOA
        </h1>
        <p className="mt-1 text-[13px] text-muted">
          Verifikasi dokumen, proses pengajuan di portal resmi, dan kirim visa
          yang terbit. Urutan berdasarkan tanggal kedatangan terdekat.
        </p>
      </div>

      {/* Toolbar: status filter + search + refresh */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className={FIELD_CLASS}
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          {STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </select>

        <form onSubmit={submitSearch} className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            placeholder="Cari kode / nama pemesan / nama atau paspor pemohon…"
            className={`${FIELD_CLASS} w-full min-w-0 sm:max-w-md`}
            aria-label="Cari pengajuan"
          />
          <button
            type="submit"
            className="inline-flex h-10 shrink-0 items-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            Cari
          </button>
        </form>

        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="inline-flex h-10 shrink-0 items-center rounded-xl border border-line bg-white px-4 text-[13px] font-medium text-ink transition-colors hover:bg-canvas"
        >
          Muat ulang
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {["Kode", "Pemesan", "Pemohon", "Kedatangan", "Status", "Total", "Dibuat"].map(
                (heading) => (
                  <th
                    key={heading}
                    className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-[13px] text-muted">
                  Memuat…
                </td>
              </tr>
            ) : data && data.rows.length > 0 ? (
              data.rows.map((row) => {
                const days = Math.ceil(
                  (new Date(row.arrivalDate).getTime() - Date.now()) / 86_400_000,
                );
                const urgent = days >= 0 && days <= 3;
                const past = days < 0;
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/admin/visa/${row.code}`)}
                    className="cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-canvas"
                  >
                    <td className="px-3 py-2.5 text-[13px]">
                      <Link
                        href={`/admin/visa/${row.code}`}
                        className="font-mono font-semibold tracking-[0.02em] text-brand-dark"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[13px]">
                      <p className="font-medium text-ink">{row.contactName || "—"}</p>
                      <p className="text-[12px] text-muted">{row.email}</p>
                    </td>
                    <td className="px-3 py-2.5 text-[13px] tabular-nums text-ink">
                      {row.applicantCount}
                    </td>
                    <td className="px-3 py-2.5 text-[13px]">
                      <span className={past ? "text-danger" : "text-ink"}>
                        {fmtDate(row.arrivalDate)}
                      </span>
                      {urgent ? (
                        <span className="ml-1.5 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          ≤ 3 hari
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-[13px]">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2.5 text-[13px] tabular-nums text-ink">
                      {fmtUsd(row.totalUsdCents)}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-muted">
                      {fmtDate(row.createdAt)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-[13px] text-muted">
                  Tidak ada pengajuan yang cocok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          {data ? `${data.total} pengajuan` : "…"} · Halaman {data?.page ?? page} dari{" "}
          {totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-3 text-[13px] font-medium text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Sebelumnya
          </button>
          <button
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-3 text-[13px] font-medium text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
          >
            Berikutnya →
          </button>
        </div>
      </div>
    </div>
  );
}
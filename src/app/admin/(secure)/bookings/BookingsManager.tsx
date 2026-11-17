"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  exportBookingsCsv,
  getAdminTransactionStats,
  listAdminBookings,
} from "@/app/actions/admin-bookings";
import type { AdminBookingStatus, AdminTransactionStats } from "@/types/admin";
import type { AdminBookingRowFull } from "@/types/admin-bookings";
import { ADMIN_BOOKING_LINES } from "@/types/admin-bookings";
import DataTable, { type Column } from "@/components/admin/DataTable";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";
import { useAdminValue } from "@/components/admin/useAdminList";
import { usd } from "@/lib/format";

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<AdminBookingStatus, string> = {
  awaiting_payment: "Menunggu Pembayaran",
  confirmed: "Dikonfirmasi",
  cancelled: "Dibatalkan",
  completed: "Selesai",
};

/** The status pill tones — restrained, the admin area stays monochrome. */
const STATUS_TONES: Record<AdminBookingStatus, string> = {
  awaiting_payment: "border-amber-200 bg-amber-50 text-amber-700",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-red-200 bg-red-50 text-red-600",
  completed: "border-[var(--admin-line)] bg-[var(--admin-hover)] text-[var(--admin-ink)]",
};

export function BookingStatusBadge({ status }: { status: AdminBookingStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const PAYMENT_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Lunas",
  failed: "Gagal",
  refunded: "Refund",
};

function serviceAtLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The transaction table — filter by line / status / code / email, status
 * counters on top, CSV export of the current filter.
 */
export default function BookingsManager() {
  const [lineSlug, setLineSlug] = useState("");
  const [status, setStatus] = useState<AdminBookingStatus | "">("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const filters = {
    lineSlug: lineSlug || undefined,
    status: status || undefined,
    query: query || undefined,
  };

  const loadList = useCallback(
    () => listAdminBookings({ ...filters, page, pageSize: PAGE_SIZE }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineSlug, status, query, page],
  );
  const { data: list, loading, error, reload } = useAdminValue(loadList);

  const loadStats = useCallback(
    () => getAdminTransactionStats(lineSlug || undefined),
    [lineSlug],
  );
  const { data: stats } = useAdminValue<AdminTransactionStats>(loadStats);

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(queryInput.trim());
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportBookingsCsv(filters);
      if (!result.ok) {
        showAdminToast(result.error, "error");
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      showAdminToast("CSV diunduh.");
    } catch (err) {
      showAdminToast(err instanceof Error ? err.message : "Gagal mengekspor CSV", "error");
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<AdminBookingRowFull>[] = [
    {
      key: "code",
      header: "Kode",
      render: (row) => (
        <Link
          href={`/admin/bookings/${row.id}`}
          className="font-medium text-[var(--admin-ink)] underline-offset-2 hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: "serviceAt",
      header: "Tanggal Layanan",
      render: (row) => <span className="tabular-nums">{serviceAtLabel(row.serviceAt)}</span>,
    },
    {
      key: "line",
      header: "Line",
      render: (row) => (
        <span className="text-[var(--admin-muted)]">{row.lineLabel ?? row.lineSlug ?? "—"}</span>
      ),
    },
    {
      key: "product",
      header: "Produk",
      render: (row) => {
        const item = row.items[0];
        if (!item) return <span className="text-[var(--admin-muted)]">—</span>;
        return (
          <span>
            {item.productTitle ?? item.label}
            {row.items.length > 1 ? (
              <span className="text-[var(--admin-muted)]"> +{row.items.length - 1}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "customer",
      header: "Customer",
      render: (row) => (
        <span>
          <span className="block">{row.customerName ?? "—"}</span>
          <span className="block text-[12px] text-[var(--admin-muted)]">{row.customerEmail ?? ""}</span>
        </span>
      ),
    },
    {
      key: "pax",
      header: "Pax",
      className: "text-right",
      render: (row) => (
        <span className="tabular-nums text-[var(--admin-muted)]">
          {row.adultCount}D / {row.childCount}A / {row.infantCount}I
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      render: (row) => <span className="tabular-nums font-medium">{usd(row.totalUsdCents / 100)}</span>,
    },
    {
      key: "payment",
      header: "Bayar",
      render: (row) =>
        row.paymentStatus ? (
          <span className={row.paymentStatus === "paid" ? "text-emerald-700" : "text-[var(--admin-muted)]"}>
            {PAYMENT_LABELS[row.paymentStatus] ?? row.paymentStatus}
          </span>
        ) : (
          <span className="text-[var(--admin-muted)]">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <BookingStatusBadge status={row.status} />,
    },
    {
      key: "driver",
      header: "Driver",
      render: (row) => (
        <span className="text-[var(--admin-muted)]">{row.driverName ?? "—"}</span>
      ),
    },
  ];

  const total = list?.total ?? 0;
  const rows = list?.rows ?? [];
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statChips: { key: AdminBookingStatus | "all"; label: string; value: number }[] = [
    { key: "all", label: "Semua", value: stats?.total ?? 0 },
    { key: "awaiting_payment", label: STATUS_LABELS.awaiting_payment, value: stats?.counts.awaiting_payment ?? 0 },
    { key: "confirmed", label: STATUS_LABELS.confirmed, value: stats?.counts.confirmed ?? 0 },
    { key: "completed", label: STATUS_LABELS.completed, value: stats?.counts.completed ?? 0 },
    { key: "cancelled", label: STATUS_LABELS.cancelled, value: stats?.counts.cancelled ?? 0 },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className={adminClass.h1}>Transaksi</h2>
          <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
            Semua booking lintas layanan. Klik kode untuk detail, assignment driver &amp; mobil, dan aksi status.
          </p>
        </div>
        <button
          type="button"
          className={adminClass.buttonSecondary}
          onClick={handleExport}
          disabled={exporting || loading}
        >
          {exporting ? "Mengekspor…" : "Export CSV"}
        </button>
      </div>

      {/* Status counters — click to filter. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {statChips.map((chip) => {
          const active = chip.key === "all" ? status === "" : status === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => {
                setStatus(chip.key === "all" ? "" : (chip.key as AdminBookingStatus));
                setPage(1);
              }}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-[var(--admin-ink)] bg-[var(--admin-hover)]"
                  : "border-[var(--admin-line)] bg-white hover:bg-[var(--admin-hover)]"
              }`}
            >
              <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--admin-muted)]">
                {chip.label}
              </span>
              <span className="mt-0.5 block text-[18px] font-semibold tabular-nums">
                {chip.value}
              </span>
            </button>
          );
        })}
        <div className={`${adminClass.panel} px-3 py-2`}>
          <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--admin-muted)]">
            Revenue (selesai)
          </span>
          <span className="mt-0.5 block text-[18px] font-semibold tabular-nums">
            {usd((stats?.completedTotalUsdCents ?? 0) / 100)}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className={`${adminClass.panel} mb-4 flex flex-wrap items-center gap-2 px-3 py-3`}>
        <select
          className={`${adminClass.input} w-auto`}
          value={lineSlug}
          onChange={(e) => {
            setLineSlug(e.target.value);
            setPage(1);
          }}
          aria-label="Filter line"
        >
          <option value="">Semua line</option>
          {ADMIN_BOOKING_LINES.map((line) => (
            <option key={line.slug} value={line.slug}>
              {line.label}
            </option>
          ))}
        </select>
        <form onSubmit={applySearch} className="flex min-w-[220px] flex-1 items-center gap-2">
          <input
            className={adminClass.input}
            placeholder="Cari kode booking atau email…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
          <button type="submit" className={adminClass.buttonSecondary}>
            Cari
          </button>
        </form>
        {(status || query || lineSlug) && (
          <button
            type="button"
            className={adminClass.buttonGhost}
            onClick={() => {
              setStatus("");
              setQuery("");
              setQueryInput("");
              setLineSlug("");
              setPage(1);
            }}
          >
            Reset filter
          </button>
        )}
      </div>

      {error ? (
        <p className={`${adminClass.panel} mb-4 px-3 py-2 text-[12px] text-danger`}>{error}</p>
      ) : null}

      <div className={adminClass.panel}>
        {loading ? (
          <p className="px-4 py-10 text-center text-[13px] text-[var(--admin-muted)]">Memuat…</p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(row) => row.id}
            emptyTitle="Belum ada booking"
            emptyDescription="Booking yang masuk dari semua layanan akan tampil di sini."
          />
        )}
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between text-[13px] text-[var(--admin-muted)]">
        <span className="tabular-nums">
          {total === 0 ? "0 booking" : `${from}–${to} dari ${total} booking`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={adminClass.buttonSecondary}
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Sebelumnya
          </button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className={adminClass.buttonSecondary}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Berikutnya →
          </button>
          <button type="button" className={adminClass.buttonGhost} onClick={reload} disabled={loading}>
            Muat ulang
          </button>
        </div>
      </div>
    </div>
  );
}

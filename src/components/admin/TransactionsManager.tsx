"use client";

import { useEffect, useRef, useState } from "react";
import {
  getAdminBooking,
  getAdminTransactionStats,
  listAdminBookings,
  setBookingStatus,
} from "@/app/actions/admin-bookings";
import type {
  AdminBookingDetail,
  AdminBookingRow,
  AdminBookingStatus,
  AdminTransactionStats,
} from "@/types/admin";
import { ADMIN_PAGE_SIZES, type AdminSortDir } from "@/types/admin-pagination";
import { ChevronLeft, ChevronRight, CloseIcon, SearchIcon } from "@/components/icons";
import DataTable, { type Column, type TableSort } from "./DataTable";
import { adminClass } from "./tokens";
import { showAdminToast } from "./toast";

/**
 * The transaction manager of one service line.
 *
 * The server page loads the stats and the first page through the admin
 * actions and hands them over as initial data; every later slice (filter,
 * search, page, refresh after a status change) is pulled client-side through
 * the same actions. Status changes only happen in the detail drawer, behind
 * a confirm dialog — the server re-checks the transition rules.
 */

const PAGE_SIZE = 5;

const STATUS_ORDER: AdminBookingStatus[] = [
  "awaiting_payment",
  "confirmed",
  "completed",
  "cancelled",
];

const STATUS_META: Record<AdminBookingStatus, { label: string; badge: string; dot: string }> = {
  awaiting_payment: {
    label: "Menunggu Pembayaran",
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
  confirmed: {
    label: "Dikonfirmasi",
    badge: "border-sky-200 bg-sky-50 text-sky-700",
    dot: "bg-sky-500",
  },
  completed: {
    label: "Selesai",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  cancelled: {
    label: "Dibatalkan",
    badge: "border-gray-200 bg-gray-50 text-gray-500",
    dot: "bg-gray-400",
  },
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: "Menunggu",
  paid: "Dibayar",
  failed: "Gagal",
  refunded: "Dikembalikan",
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateTime = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Integer USD cents → "$1,234.56" (en-US). */
function formatUsd(cents: number): string {
  return usd.format(cents / 100);
}

function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

function StatusBadge({ status }: { status: AdminBookingStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/** One label / value row of the drawer. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="shrink-0 text-[12px] text-[var(--admin-muted)]">{label}</span>
      <span className="min-w-0 text-right text-[13px]">{children}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className={`${adminClass.label} mb-1 mt-5 first:mt-0`}>{children}</p>;
}

export default function TransactionsManager({
  lineSlug,
  lineName,
  initialStats,
  initialRows,
  initialTotal,
}: {
  lineSlug: string;
  lineName: string;
  initialStats: AdminTransactionStats;
  initialRows: AdminBookingRow[];
  initialTotal: number;
}) {
  const [status, setStatus] = useState<"all" | AdminBookingStatus>("all");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(PAGE_SIZE);
  const [sort, setSort] = useState<TableSort | null>(null);
  const [rows, setRows] = useState<AdminBookingRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [stats, setStats] = useState<AdminTransactionStats>(initialStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  // The detail drawer.
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminBookingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  // The confirm dialog inside the drawer.
  const [confirm, setConfirm] = useState<"completed" | "cancelled" | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");

  // The server already loaded the exact slice (all statuses, no search,
  // page 1) — the first effect run must not fetch it again.
  const listInitialized = useRef(true);
  const statsInitialized = useRef(true);

  useEffect(() => {
    if (listInitialized.current) {
      listInitialized.current = false;
      if (status === "all" && query === "" && page === 1 && !sort && pageSize === PAGE_SIZE) {
        return;
      }
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    listAdminBookings({
      lineSlug,
      status: status === "all" ? undefined : status,
      query: query === "" ? undefined : query,
      page,
      pageSize,
      sortBy: sort?.key,
      sortDir: sort?.dir,
    })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lineSlug, status, query, page, pageSize, sort, nonce]);

  useEffect(() => {
    if (statsInitialized.current) {
      statsInitialized.current = false;
      return;
    }
    let cancelled = false;
    getAdminTransactionStats(lineSlug)
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch(() => {
        // The list effect surfaces load errors; stale stats are harmless.
      });
    return () => {
      cancelled = true;
    };
  }, [lineSlug, nonce]);

  // Load the drawer content whenever a booking is opened.
  useEffect(() => {
    if (!drawerId) return;
    let cancelled = false;
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    getAdminBooking(drawerId)
      .then((result) => {
        if (cancelled) return;
        if (result) setDetail(result);
        else setDetailError("Booking tidak ditemukan.");
      })
      .catch((err: unknown) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : "Gagal memuat data");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerId]);

  const closeDrawer = () => {
    if (acting) return;
    setDrawerId(null);
    setDetail(null);
    setDetailError("");
    setConfirm(null);
    setActionError("");
  };

  // Escape closes the drawer (unless a transition is running).
  useEffect(() => {
    if (!drawerId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerId, acting]);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(searchInput.trim());
    setPage(1);
  };

  const changeStatus = (next: "all" | AdminBookingStatus) => {
    setStatus(next);
    setPage(1);
  };

  const setPageSize = (next: number) => {
    setPageSizeState(next);
    setPage(1);
  };

  const toggleSort = (key: string) => {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: (prev.dir === "asc" ? "desc" : "asc") as AdminSortDir }
        : { key, dir: "asc" },
    );
    setPage(1);
  };

  const runStatusAction = async () => {
    if (!detail || !confirm || acting) return;
    setActing(true);
    setActionError("");
    try {
      const result = await setBookingStatus(detail.id, confirm);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      showAdminToast(
        confirm === "completed"
          ? `Booking ${detail.code} selesai — stok unit kembali tersedia.`
          : `Booking ${detail.code} dibatalkan — reservasi stok dilepas.`,
      );
      setConfirm(null);
      // Refresh the drawer so the new status (and disabled buttons) show.
      const fresh = await getAdminBooking(detail.id);
      if (fresh) setDetail(fresh);
      setNonce((n) => n + 1);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setActing(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const columns: Column<AdminBookingRow>[] = [
    {
      key: "code",
      header: "Kode",
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          <div className="font-medium tabular-nums">{row.code}</div>
          <div className="text-[11px] text-[var(--admin-muted)]">
            {formatDateTime(row.createdAt)}
          </div>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Pelanggan",
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate">{row.customerName ?? "—"}</div>
          <div className="truncate text-[11px] text-[var(--admin-muted)]">
            {row.customerEmail ?? "—"}
          </div>
        </div>
      ),
    },
    {
      key: "products",
      header: "Produk",
      render: (row) => {
        const first = row.items[0];
        if (!first) return <span className="text-[var(--admin-muted)]">—</span>;
        return (
          <div className="min-w-0 max-w-[260px]">
            <div className="truncate">{first.productTitle ?? first.label}</div>
            <div className="truncate text-[11px] text-[var(--admin-muted)]">
              {first.packageLabel ?? "—"}
              {row.items.length > 1 ? ` · +${row.items.length - 1} lainnya` : ""}
            </div>
          </div>
        );
      },
    },
    {
      key: "serviceAt",
      header: "Layanan",
      sortable: true,
      render: (row) => (
        <span className="whitespace-nowrap tabular-nums">{formatDateTime(row.serviceAt)}</span>
      ),
    },
    {
      key: "units",
      header: "Unit",
      className: "text-right",
      render: (row) => <span className="tabular-nums">{row.vehicleCount}</span>,
    },
    {
      key: "totalUsdCents",
      header: "Total",
      className: "text-right",
      sortable: true,
      render: (row) => (
        <span className="whitespace-nowrap tabular-nums">{formatUsd(row.totalUsdCents)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "",
      className: "w-[80px] text-right",
      render: (row) => (
        <button
          type="button"
          onClick={() => setDrawerId(row.id)}
          className={`${adminClass.buttonSecondary} h-8 px-2.5 text-[12px]`}
        >
          Detail
        </button>
      ),
    },
  ];

  const canComplete = detail?.status === "confirmed";
  const canCancel =
    detail?.status === "awaiting_payment" || detail?.status === "confirmed";

  return (
    <div>
      <div className="mb-6">
        <h2 className={adminClass.h1}>Transaksi — {lineName}</h2>
        <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
          Booking pelanggan per service line. Serah terima dan pembatalan mengubah status
          booking; stok unit kembali tersedia otomatis.
        </p>
      </div>

      {/* Stats chips */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STATUS_ORDER.map((key) => (
          <div key={key} className={`${adminClass.panel} px-4 py-3`}>
            <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--admin-muted)]">
              {STATUS_META[key].label}
            </span>
            <span className="mt-1 block text-[20px] font-semibold tabular-nums tracking-[-0.02em]">
              {stats.counts[key]}
            </span>
          </div>
        ))}
        <div className={`${adminClass.panel} px-4 py-3`}>
          <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--admin-muted)]">
            Total Selesai (USD)
          </span>
          <span className="mt-1 block text-[20px] font-semibold tabular-nums tracking-[-0.02em]">
            {formatUsd(stats.completedTotalUsdCents)}
          </span>
        </div>
      </div>

      {/* Filter tabs + search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => changeStatus("all")}
            className={`${adminClass.pill} ${
              status === "all"
                ? "border-[var(--admin-ink)] bg-white font-semibold text-[var(--admin-ink)]"
                : adminClass.pillOff
            }`}
          >
            Semua ({stats.total})
          </button>
          {STATUS_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => changeStatus(key)}
              className={`${adminClass.pill} ${
                status === key
                  ? "border-[var(--admin-ink)] bg-white font-semibold text-[var(--admin-ink)]"
                  : adminClass.pillOff
              }`}
            >
              {STATUS_META[key].label} ({stats.counts[key]})
            </button>
          ))}
        </div>

        <form onSubmit={submitSearch} className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon
              width={14}
              height={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--admin-muted)]"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari kode / email…"
              aria-label="Cari booking berdasarkan kode atau email"
              className={`${adminClass.input} w-[220px] pl-8`}
            />
          </div>
          <button type="submit" className={adminClass.buttonSecondary}>
            Cari
          </button>
          {query !== "" ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setQuery("");
                setPage(1);
              }}
              className={adminClass.buttonGhost}
            >
              Reset
            </button>
          ) : null}
        </form>
      </div>

      {error ? (
        <p className={`${adminClass.panel} mb-4 px-3 py-2 text-[12px] text-danger`}>{error}</p>
      ) : null}

      {/* Table */}
      <div className={adminClass.panel}>
        {loading ? (
          <p className="px-6 py-10 text-center text-[13px] text-[var(--admin-muted)]">Memuat…</p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(row) => row.id}
            emptyTitle="Belum ada booking"
            emptyDescription={`Belum ada booking untuk ${lineName} pada filter ini.`}
            sort={sort}
            onSortToggle={toggleSort}
            loading={loading}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--admin-line)] px-3 py-2.5">
          <p className="text-[12px] tabular-nums text-[var(--admin-muted)]">
            {total} booking · Halaman {Math.min(page, pageCount)} dari {pageCount}
          </p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-[var(--admin-muted)]">
              <span className="text-[11px]">Baris</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="Jumlah baris per halaman"
                className="h-8 rounded-lg border border-[var(--admin-line)] bg-white px-1.5 text-[12px] text-[var(--admin-ink)] outline-none focus:border-[var(--admin-ink)]"
              >
                {ADMIN_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`${adminClass.buttonSecondary} h-8 px-2.5 text-[12px]`}
            >
              <ChevronLeft width={13} height={13} className="mr-1" />
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= pageCount || loading}
              onClick={() => setPage((p) => p + 1)}
              className={`${adminClass.buttonSecondary} h-8 px-2.5 text-[12px]`}
            >
              Berikutnya
              <ChevronRight width={13} height={13} className="ml-1" />
            </button>
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {drawerId ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Tutup detail"
            onClick={closeDrawer}
            className="absolute inset-0 h-full w-full cursor-default bg-black/30"
          />
          <aside className={adminClass.drawer} role="dialog" aria-modal="true" aria-label="Detail booking">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <h2 className="truncate text-[15px] font-semibold tabular-nums tracking-[-0.01em]">
                  {detail?.code ?? "Detail Booking"}
                </h2>
                {detail ? <StatusBadge status={detail.status} /> : null}
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Tutup"
                className={`${adminClass.buttonGhost} h-8 w-8 p-0`}
              >
                <CloseIcon width={15} height={15} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {detailLoading ? (
                <p className="py-10 text-center text-[13px] text-[var(--admin-muted)]">Memuat…</p>
              ) : detailError ? (
                <p className="py-10 text-center text-[13px] text-danger">{detailError}</p>
              ) : detail ? (
                <>
                  <SectionTitle>Pelanggan</SectionTitle>
                  <DetailRow label="Nama">{detail.customerName ?? "—"}</DetailRow>
                  <DetailRow label="Email">{detail.customerEmail ?? "—"}</DetailRow>
                  {detail.contact ? (
                    <>
                      <DetailRow label="Telepon">
                        {detail.contact.phoneCountryCode} {detail.contact.phone}
                      </DetailRow>
                      {detail.contact.nationality ? (
                        <DetailRow label="Kewarganegaraan">{detail.contact.nationality}</DetailRow>
                      ) : null}
                      {detail.contact.identityNumber ? (
                        <DetailRow label={`Identitas (${detail.contact.idType ?? "—"})`}>
                          <span className="tabular-nums">{detail.contact.identityNumber}</span>
                        </DetailRow>
                      ) : null}
                    </>
                  ) : null}

                  <SectionTitle>Layanan</SectionTitle>
                  <DetailRow label="Waktu layanan">{formatDateTime(detail.serviceAt)}</DetailRow>
                  <DetailRow label="Dibuat">{formatDateTime(detail.createdAt)}</DetailRow>
                  <DetailRow label="Penumpang">
                    {detail.adultCount} dewasa
                    {detail.childCount > 0 ? ` · ${detail.childCount} anak` : ""}
                    {detail.infantCount > 0 ? ` · ${detail.infantCount} bayi` : ""}
                  </DetailRow>
                  <DetailRow label="Unit kendaraan">
                    <span className="tabular-nums">{detail.vehicleCount}</span>
                  </DetailRow>
                  {detail.driverOption ? (
                    <DetailRow label="Opsi supir">
                      {detail.driverOption === "with_driver"
                        ? "Dengan supir"
                        : "Tanpa supir (lepas kunci)"}
                    </DetailRow>
                  ) : null}
                  {detail.pickupPolicy ? (
                    <DetailRow label="Kebijakan pickup">
                      {detail.pickupPolicy === "vendor_pickup"
                        ? "Ambil di lokasi vendor"
                        : "Diantar ke lokasi"}
                    </DetailRow>
                  ) : null}
                  {detail.pickupLabel ? (
                    <DetailRow label="Pickup">{detail.pickupLabel}</DetailRow>
                  ) : null}
                  {detail.dropoffLabel ? (
                    <DetailRow label="Drop-off">{detail.dropoffLabel}</DetailRow>
                  ) : null}
                  {detail.flight?.flightCode || detail.flight?.airline ? (
                    <DetailRow label="Penerbangan">
                      {[detail.flight?.airline, detail.flight?.flightCode]
                        .filter(Boolean)
                        .join(" · ")}
                    </DetailRow>
                  ) : null}
                  {detail.notes ? (
                    <DetailRow label="Catatan pelanggan">{detail.notes}</DetailRow>
                  ) : null}

                  <SectionTitle>Item Booking</SectionTitle>
                  <div className={`${adminClass.panel} divide-y divide-[var(--admin-line)]/70`}>
                    {detail.items.map((item, index) => (
                      <div key={index} className="px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium">
                              {item.productTitle ?? item.label}
                            </p>
                            <p className="truncate text-[11px] text-[var(--admin-muted)]">
                              {item.packageLabel ?? "—"}
                            </p>
                          </div>
                          <span className="shrink-0 tabular-nums text-[13px]">
                            {formatUsd(item.totalUsdCents)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] tabular-nums text-[var(--admin-muted)]">
                          {item.quantity}{" "}
                          {item.unitKind === "per_day"
                            ? "hari"
                            : item.unitKind === "per_pax"
                              ? "pax"
                              : "unit"}{" "}
                          × {formatUsd(item.unitUsdCents)}
                        </p>
                      </div>
                    ))}
                    {detail.addOns.map((addOn, index) => (
                      <div key={`addon-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
                        <p className="min-w-0 truncate text-[12px] text-[var(--admin-muted)]">
                          Add-on: {addOn.label} × {addOn.quantity}
                        </p>
                        <span className="shrink-0 tabular-nums text-[12px]">
                          {formatUsd(addOn.totalUsdCents)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <SectionTitle>Pembayaran</SectionTitle>
                  {detail.payment ? (
                    <>
                      <DetailRow label="Status">
                        {PAYMENT_LABELS[detail.payment.status] ?? detail.payment.status}
                      </DetailRow>
                      <DetailRow label="Jumlah">{formatUsd(detail.payment.amountUsdCents)}</DetailRow>
                      {detail.payment.methodLabel ? (
                        <DetailRow label="Metode">{detail.payment.methodLabel}</DetailRow>
                      ) : null}
                      {detail.payment.provider ? (
                        <DetailRow label="Provider">{detail.payment.provider}</DetailRow>
                      ) : null}
                      {detail.payment.reference ? (
                        <DetailRow label="Referensi">
                          <span className="break-all tabular-nums">{detail.payment.reference}</span>
                        </DetailRow>
                      ) : null}
                      {detail.payment.paidAt ? (
                        <DetailRow label="Dibayar">{formatDateTime(detail.payment.paidAt)}</DetailRow>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-[12px] text-[var(--admin-muted)]">Belum ada pembayaran.</p>
                  )}
                  {detail.invoiceNumber ? (
                    <DetailRow label="Invoice">
                      <span className="break-all tabular-nums">{detail.invoiceNumber}</span>
                    </DetailRow>
                  ) : null}

                  <SectionTitle>Ringkasan Biaya</SectionTitle>
                  <DetailRow label="Subtotal">{formatUsd(detail.subtotalUsdCents)}</DetailRow>
                  {detail.addOnsUsdCents > 0 ? (
                    <DetailRow label="Add-on">{formatUsd(detail.addOnsUsdCents)}</DetailRow>
                  ) : null}
                  {detail.discountUsdCents > 0 ? (
                    <DetailRow label={`Diskon${detail.promoCode ? ` (${detail.promoCode})` : ""}`}>
                      −{formatUsd(detail.discountUsdCents)}
                    </DetailRow>
                  ) : null}
                  {detail.taxUsdCents > 0 ? (
                    <DetailRow label="Pajak">{formatUsd(detail.taxUsdCents)}</DetailRow>
                  ) : null}
                  <DetailRow label="Total">
                    <span className="font-semibold tabular-nums">
                      {formatUsd(detail.totalUsdCents)}
                    </span>
                  </DetailRow>
                </>
              ) : null}
            </div>

            {/* Actions */}
            {detail ? (
              <footer className="border-t border-[var(--admin-line)] px-5 py-4">
                {actionError ? (
                  <p className="mb-3 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-danger">
                    {actionError}
                  </p>
                ) : null}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={!canCancel || acting}
                    onClick={() => {
                      setActionError("");
                      setConfirm("cancelled");
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--admin-line)] bg-white px-3 text-[13px] font-medium text-danger transition-colors hover:bg-[var(--admin-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    title={
                      canCancel
                        ? "Batalkan booking ini"
                        : "Hanya booking menunggu pembayaran / dikonfirmasi yang dapat dibatalkan"
                    }
                  >
                    Batalkan
                  </button>
                  <button
                    type="button"
                    disabled={!canComplete || acting}
                    onClick={() => {
                      setActionError("");
                      setConfirm("completed");
                    }}
                    className={adminClass.buttonPrimary}
                    title={
                      canComplete
                        ? "Tandai selesai — layanan sudah diserahterimakan"
                        : "Hanya booking berstatus Dikonfirmasi yang dapat diselesaikan"
                    }
                  >
                    Serah Terima (Selesai)
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-[var(--admin-muted)]">
                  {detail.status === "completed" || detail.status === "cancelled"
                    ? "Booking ini sudah berstatus final — tidak ada aksi lanjutan."
                    : "Menyelesaikan atau membatalkan booking mengembalikan stok unitnya ke ketersediaan."}
                </p>
              </footer>
            ) : null}
          </aside>

          {/* Confirm dialog */}
          {confirm && detail ? (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <button
                type="button"
                aria-label="Tutup konfirmasi"
                onClick={acting ? undefined : () => setConfirm(null)}
                className="absolute inset-0 h-full w-full cursor-default bg-black/30"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Konfirmasi aksi"
                className="relative w-full max-w-[440px] rounded-lg border border-[var(--admin-line)] bg-white shadow-[0_8px_40px_rgba(16,24,40,0.16)]"
              >
                <header className="border-b border-[var(--admin-line)] px-5 py-4">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
                    {confirm === "completed" ? "Serah Terima (Selesai)" : "Batalkan Booking"}
                  </h2>
                </header>
                <div className="px-5 py-4">
                  <p className="text-[13px] leading-relaxed">
                    {confirm === "completed" ? (
                      <>
                        Tandai booking <strong className="tabular-nums">{detail.code}</strong>{" "}
                        sebagai selesai? Layanan dianggap sudah diserahterimakan ke pelanggan.
                      </>
                    ) : (
                      <>
                        Batalkan booking <strong className="tabular-nums">{detail.code}</strong>?
                        Booking tidak akan dilanjutkan.
                      </>
                    )}
                  </p>
                  <p className="mt-2 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-[var(--admin-muted)]">
                    {confirm === "completed"
                      ? "Stok unit yang dipesan booking ini akan kembali tersedia untuk dijual."
                      : "Reservasi stok booking ini akan dilepas kembali ke ketersediaan."}{" "}
                    Tindakan ini tidak dapat dibatalkan.
                  </p>
                  {actionError ? (
                    <p className="mt-3 rounded-lg border border-[var(--admin-line)] px-3 py-2 text-[12px] text-danger">
                      {actionError}
                    </p>
                  ) : null}
                </div>
                <footer className="flex items-center justify-end gap-2 border-t border-[var(--admin-line)] px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setConfirm(null)}
                    disabled={acting}
                    className={adminClass.buttonSecondary}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={runStatusAction}
                    disabled={acting}
                    className={
                      confirm === "completed"
                        ? adminClass.buttonPrimary
                        : "inline-flex h-9 items-center justify-center rounded-lg bg-danger px-3 text-[13px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    }
                  >
                    {acting
                      ? "Memproses…"
                      : confirm === "completed"
                        ? "Ya, Selesai"
                        : "Ya, Batalkan"}
                  </button>
                </footer>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  exportOrdersTable,
  listOrders,
  type AdminOrderRow,
} from "@/app/actions/admin-orders";
import ExportButtons from "@/components/admin/ExportButtons";
import { ADMIN_PAGE_SIZES, type AdminSortDir } from "@/types/admin-pagination";
import DataTable, { type Column, type TableSort } from "@/components/admin/DataTable";
import { adminClass } from "@/components/admin/tokens";
import { useAdminValue } from "@/components/admin/useAdminList";
import { formatCents } from "@/components/admin/MoneyField";
import { ArrowRightIcon, SearchIcon } from "@/components/icons";
import {
  OPS_STATUS_FLOW,
  OPS_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  formatDate,
  formatDateTime,
  opsStatusBadge,
  paymentStatusBadge,
} from "@/components/admin/orderStatus";

const PAGE_SIZE = 5;

/** "2 dewasa · 1 anak" — the pax summary of a row. */
function paxSummary(row: AdminOrderRow): string {
  const parts: string[] = [];
  if (row.adultCount > 0) parts.push(`${row.adultCount} dewasa`);
  if (row.childCount > 0) parts.push(`${row.childCount} anak`);
  if (row.infantCount > 0) parts.push(`${row.infantCount} bayi`);
  return parts.join(" · ") || "—";
}

/**
 * The Airport VIP order table.
 *
 * Rows come from `listOrders()` (a server action) so the page shell stays
 * static. Filters and the search box re-query from page 0; pagination is
 * prev/next over the total the action returns, with a 5/10/20/50 page-size
 * selector and sortable column headers.
 */
export default function OrdersManager() {
  const [searchDraft, setSearchDraft] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [opsStatus, setOpsStatus] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(PAGE_SIZE);
  const [sort, setSort] = useState<TableSort | null>(null);

  const load = useCallback(
    () =>
      listOrders({
        q: q || undefined,
        status: status || undefined,
        opsStatus: opsStatus || undefined,
        limit: pageSize,
        offset: page * pageSize,
        sortBy: sort?.key,
        sortDir: sort?.dir,
      }),
    [q, status, opsStatus, page, pageSize, sort],
  );
  const { data, loading, error } = useAdminValue(load);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const filtered = q !== "" || status !== "" || opsStatus !== "";

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setQ(searchDraft.trim());
    setPage(0);
  };

  const setPageSize = (next: number) => {
    setPageSizeState(next);
    setPage(0);
  };

  const toggleSort = (key: string) => {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: (prev.dir === "asc" ? "desc" : "asc") as AdminSortDir }
        : { key, dir: "asc" },
    );
    setPage(0);
  };

  const columns: Column<AdminOrderRow>[] = [
    {
      key: "code",
      header: "Kode",
      sortable: true,
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/admin/orders/${row.id}`}
            className="font-medium hover:underline"
          >
            {row.code}
          </Link>
          <div className="text-[11px] text-[var(--admin-muted)]">
            {formatDate(row.createdAt)}
          </div>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Pelanggan",
      render: (row) => (
        <div className="min-w-0 max-w-[220px]">
          <div className="truncate font-medium">{row.contactName}</div>
          <div className="truncate text-[11px] text-[var(--admin-muted)]">
            {row.contactEmail || "—"}
            {row.nationality ? ` · ${row.nationality}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "serviceAt",
      header: "Jadwal",
      sortable: true,
      render: (row) => (
        <span className="whitespace-nowrap text-[12px]">{formatDateTime(row.serviceAt)}</span>
      ),
    },
    {
      key: "airport",
      header: "Bandara / Penerbangan",
      render: (row) => (
        <div className="min-w-0 max-w-[220px]">
          <div className="truncate">{row.airportSummary}</div>
          <div className="truncate text-[11px] text-[var(--admin-muted)]">
            {row.flightSummary}
          </div>
        </div>
      ),
    },
    {
      key: "pax",
      header: "Pax",
      render: (row) => (
        <span className="whitespace-nowrap text-[12px] text-[var(--admin-muted)]">
          {paxSummary(row)}
        </span>
      ),
    },
    {
      key: "totalUsdCents",
      header: "Total",
      className: "text-right",
      sortable: true,
      render: (row) => (
        <span className="tabular-nums">{formatCents(row.totalUsdCents)}</span>
      ),
    },
    {
      key: "status",
      header: "Pembayaran",
      sortable: true,
      render: (row) => (
        <span className={paymentStatusBadge(row.status)}>
          {PAYMENT_STATUS_LABELS[row.status] ?? row.status}
        </span>
      ),
    },
    {
      key: "opsStatus",
      header: "Operasional",
      sortable: true,
      render: (row) => (
        <span className={opsStatusBadge(row.opsStatus)}>
          {OPS_STATUS_LABELS[row.opsStatus] ?? row.opsStatus}
        </span>
      ),
    },
    {
      key: "docs",
      header: "Dokumen",
      className: "text-right",
      render: (row) => (
        <span
          className="tabular-nums text-[12px]"
          title={`${row.docsReceived} dari ${row.docsTotal} penumpang dokumennya siap`}
        >
          {row.docsTotal === 0 ? "—" : `${row.docsReceived}/${row.docsTotal}`}
        </span>
      ),
    },
    {
      key: "__actions",
      header: "",
      className: "w-[80px] text-right",
      render: (row) => (
        <Link
          href={`/admin/orders/${row.id}`}
          className={`${adminClass.buttonGhost} h-8`}
          aria-label={`Detail order ${row.code}`}
        >
          Detail
          <ArrowRightIcon width={14} height={14} className="ml-1" />
        </Link>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={adminClass.h1}>Orders</h1>
          <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
            Pesanan Airport VIP — fast track dan penanganan dokumen penumpang.
          </p>
        </div>
        {/* Export the current filter (search + payment + ops status). */}
        <ExportButtons
          disabled={loading}
          load={() =>
            exportOrdersTable({
              q: q || undefined,
              status: status || undefined,
              opsStatus: opsStatus || undefined,
            })
          }
        />
      </div>

      {error ? (
        <p className={`${adminClass.panel} mb-4 px-3 py-2 text-[12px] text-danger`}>{error}</p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={submitSearch} className="flex items-center gap-2">
          <div className="relative w-[240px]">
            <SearchIcon
              width={14}
              height={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--admin-muted)]"
            />
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Cari kode / nama / email…"
              aria-label="Cari order"
              className={`${adminClass.input} pl-8`}
            />
          </div>
          <button type="submit" className={adminClass.buttonSecondary}>
            Cari
          </button>
        </form>

        <div className="w-[190px]">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
            aria-label="Filter status pembayaran"
            className={adminClass.input}
          >
            <option value="">Semua pembayaran</option>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="w-[190px]">
          <select
            value={opsStatus}
            onChange={(e) => {
              setOpsStatus(e.target.value);
              setPage(0);
            }}
            aria-label="Filter status operasional"
            className={adminClass.input}
          >
            <option value="">Semua operasional</option>
            {OPS_STATUS_FLOW.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {filtered ? (
          <button
            type="button"
            className={adminClass.buttonGhost}
            onClick={() => {
              setSearchDraft("");
              setQ("");
              setStatus("");
              setOpsStatus("");
              setPage(0);
            }}
          >
            Reset filter
          </button>
        ) : null}
      </div>

      <div className={adminClass.panel}>
        {loading ? (
          <p className="px-6 py-10 text-center text-[13px] text-[var(--admin-muted)]">Memuat…</p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(row) => row.id}
            emptyTitle={filtered ? "Tidak ada order yang cocok" : "Belum ada order"}
            emptyDescription={
              filtered
                ? "Coba ubah kata kunci atau filter status."
                : "Pesanan dari halaman Airport VIP akan muncul di sini."
            }
            sort={sort}
            onSortToggle={toggleSort}
            loading={loading}
          />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-[12px] text-[var(--admin-muted)]">
          {total === 0 ? "0 order" : `Menampilkan ${from}–${to} dari ${total} order`}
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
            className={adminClass.buttonSecondary}
            disabled={loading || page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Sebelumnya
          </button>
          <span className="text-[12px] tabular-nums text-[var(--admin-muted)]">
            {Math.min(page + 1, pageCount)} / {pageCount}
          </span>
          <button
            type="button"
            className={adminClass.buttonSecondary}
            disabled={loading || page >= pageCount - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Berikutnya
          </button>
        </div>
      </div>
    </div>
  );
}
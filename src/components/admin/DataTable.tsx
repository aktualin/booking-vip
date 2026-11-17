"use client";

import type { ReactNode } from "react";
import { SearchIcon, ChevronLeft, ChevronRight, ArrowUpIcon, ArrowDownIcon } from "@/components/icons";
import { ADMIN_PAGE_SIZES, type AdminSortDir } from "@/types/admin-pagination";
import { adminClass } from "./tokens";
import EmptyState from "./EmptyState";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** Render a clickable sort control in this column's header. */
  sortable?: boolean;
};

export type TableSort = { key: string; dir: AdminSortDir };

export type TablePagination = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Noun used in the range label — "data" by default. */
  itemLabel?: string;
};

/**
 * Generic admin table.
 *
 * Monochrome by design: hairline row borders, no zebra striping, no rounded
 * cells. `columns` are supplied by the caller so each catalog table decides
 * its own cell content.
 *
 * Optional chrome — all driven by the caller so the simple usages stay simple:
 *  - `search` / `onSearchChange` renders the global search box,
 *  - `sort` / `onSortToggle` makes the `sortable` headers clickable,
 *  - `pagination` renders the range label, prev/next and page-size selector.
 */
export default function DataTable<T>({
  columns,
  rows,
  getKey,
  emptyTitle,
  emptyDescription,
  emptyAction,
  search,
  onSearchChange,
  searchPlaceholder = "Cari…",
  sort,
  onSortToggle,
  pagination,
  loading,
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  sort?: TableSort | null;
  onSortToggle?: (key: string) => void;
  pagination?: TablePagination;
  loading?: boolean;
}) {
  const interactive = Boolean(onSearchChange || pagination || onSortToggle);

  // The plain (non-interactive) usage keeps the original bare empty state.
  if (!interactive && rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 1;
  const from = !pagination || pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const to = pagination ? Math.min(pagination.total, pagination.page * pagination.pageSize) : rows.length;
  const itemLabel = pagination?.itemLabel ?? "data";

  const sortIcon = (key: string) => {
    if (!sort || sort.key !== key) {
      return (
        <span className="ml-1 inline-flex flex-col text-[7px] leading-[0.6] text-[var(--admin-line)]">
          <span>▲</span>
          <span>▼</span>
        </span>
      );
    }
    return sort.dir === "asc" ? (
      <ArrowUpIcon width={10} height={10} className="ml-1 inline-block" />
    ) : (
      <ArrowDownIcon width={10} height={10} className="ml-1 inline-block" />
    );
  };

  return (
    <div>
      {onSearchChange ? (
        <div className="flex items-center justify-end gap-2 border-b border-[var(--admin-line)] px-3 py-2.5">
          <div className="relative w-full max-w-[280px]">
            <SearchIcon
              width={14}
              height={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--admin-muted)]"
            />
            <input
              type="search"
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className={`${adminClass.input} h-8 pl-8 text-[12px]`}
            />
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={search ? "Tidak ada hasil" : emptyTitle}
          description={
            search
              ? `Tidak ada ${itemLabel} yang cocok dengan pencarian "${search}".`
              : emptyDescription
          }
          action={search ? undefined : emptyAction}
        />
      ) : (
        <div className={`overflow-x-auto ${loading ? "opacity-60 transition-opacity" : ""}`}>
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr>
                {columns.map((c) => {
                  const canSort = Boolean(c.sortable && onSortToggle);
                  return (
                    <th
                      key={c.key}
                      className={`${adminClass.tableHead} ${c.className ?? ""}`}
                      aria-sort={
                        sort?.key === c.key
                          ? sort.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => onSortToggle!(c.key)}
                          className={`inline-flex items-center uppercase tracking-[0.06em] transition-colors hover:text-[var(--admin-ink)] ${
                            sort?.key === c.key ? "text-[var(--admin-ink)]" : ""
                          } ${c.className?.includes("text-right") ? "flex-row-reverse" : ""}`}
                          title={`Urutkan berdasarkan ${c.header}`}
                        >
                          {c.header}
                          {sortIcon(c.key)}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={getKey(row)} className={adminClass.tableRow}>
                  {columns.map((c) => (
                    <td key={c.key} className={`${adminClass.tableCell} ${c.className ?? ""}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--admin-line)] px-3 py-2.5 text-[12px] text-[var(--admin-muted)]">
          <span className="tabular-nums">
            {pagination.total === 0
              ? `0 ${itemLabel}`
              : `Menampilkan ${from}–${to} dari ${pagination.total} ${itemLabel}`}
          </span>
          <div className="flex items-center gap-2">
            {pagination.onPageSizeChange ? (
              <label className="flex items-center gap-1.5">
                <span className="text-[11px]">Baris</span>
                <select
                  value={pagination.pageSize}
                  onChange={(e) => pagination.onPageSizeChange!(Number(e.target.value))}
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
            ) : null}
            <button
              type="button"
              onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}
              disabled={loading || pagination.page <= 1}
              aria-label="Halaman sebelumnya"
              className={`${adminClass.buttonGhost} h-8 w-8 p-0 disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <ChevronLeft width={14} height={14} />
            </button>
            <span className="tabular-nums">
              Halaman {Math.min(pagination.page, totalPages)} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => pagination.onPageChange(Math.min(totalPages, pagination.page + 1))}
              disabled={loading || pagination.page >= totalPages}
              aria-label="Halaman berikutnya"
              className={`${adminClass.buttonGhost} h-8 w-8 p-0 disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <ChevronRight width={14} height={14} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

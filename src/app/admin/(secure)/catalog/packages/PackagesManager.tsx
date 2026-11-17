"use client";

import { useCallback } from "react";
import { listPackagesPaged, reorderCatalog, setCatalogActive } from "@/app/actions/admin";
import { deleteAdminEntity } from "@/app/actions/admin-crud";
import type { AdminPackageRow } from "@/types/admin";
import type { AdminListParams } from "@/types/admin-pagination";
import EntityManager from "@/components/admin/EntityManager";
import StatusToggle from "@/components/admin/StatusToggle";
import { formatCents } from "@/components/admin/MoneyField";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";
import { adminClass } from "@/components/admin/tokens";
import { useAdminPagedList } from "@/components/admin/useAdminList";

/** Package catalog table — one row per purchasable variant of a product. */
export default function PackagesManager() {
  const load = useCallback((params: AdminListParams) => listPackagesPaged(params), []);
  const {
    rows,
    total,
    page,
    pageSize,
    searchInput,
    sort,
    loading,
    error,
    reload,
    setPage,
    setPageSize,
    setSearchInput,
    toggleSort,
  } = useAdminPagedList<AdminPackageRow>(load);

  const priceOf = (row: AdminPackageRow) => {
    const cents =
      row.unitKind === "per_unit" ? row.unitUsdCents : row.adultUsdCents ?? row.unitUsdCents;
    return cents == null ? "—" : formatCents(cents);
  };

  const columns = [
    {
      key: "label",
      header: "Paket",
      sortable: true,
      render: (row: AdminPackageRow) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.label}</div>
          <div className="truncate text-[11px] text-[var(--admin-muted)]">{row.productTitle}</div>
        </div>
      ),
    },
    {
      key: "unitKind",
      header: "Unit",
      sortable: true,
      render: (row: AdminPackageRow) => (
        <span className="text-[12px] text-[var(--admin-muted)]">
          {row.unitKind === "per_pax" ? "Per pax" : "Per unit"}
        </span>
      ),
    },
    {
      key: "unitUsdCents",
      header: "Harga",
      className: "text-right",
      sortable: true,
      render: (row: AdminPackageRow) => <span className="tabular-nums">{priceOf(row)}</span>,
    },
    {
      key: "order",
      header: "Urutan",
      className: "w-[76px]",
      render: (row: AdminPackageRow) => (
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Naikkan urutan"
            className={`${adminClass.buttonGhost} h-7 w-7 p-0`}
            onClick={async () => {
              await reorderCatalog({ table: "package", id: row.id, direction: "up" });
              reload();
            }}
          >
            <ArrowUpIcon width={14} height={14} />
          </button>
          <button
            type="button"
            aria-label="Turunkan urutan"
            className={`${adminClass.buttonGhost} h-7 w-7 p-0`}
            onClick={async () => {
              await reorderCatalog({ table: "package", id: row.id, direction: "down" });
              reload();
            }}
          >
            <ArrowDownIcon width={14} height={14} />
          </button>
        </span>
      ),
    },
    {
      key: "active",
      header: "Status",
      className: "w-[70px]",
      sortable: true,
      render: (row: AdminPackageRow) => (
        <StatusToggle
          active={row.active}
          onChange={async (next) => {
            await setCatalogActive({ table: "package", id: row.id, active: next });
            reload();
          }}
        />
      ),
    },
  ];

  return (
    <div>
      {error ? (
        <p className={`${adminClass.panel} mb-4 px-3 py-2 text-[12px] text-danger`}>{error}</p>
      ) : null}
      <EntityManager
        rows={rows}
        columns={columns}
        getKey={(row) => row.id}
        createHref="/admin/catalog/packages/new"
        editHref={(row) => `/admin/catalog/packages/${row.id}`}
        nameOf={(row) => row.label}
        itemLabel="Paket"
        onDelete={async (row, typedName) => {
          const result = await deleteAdminEntity({
            table: "package",
            id: row.id,
            confirmName: typedName,
          });
          if (result.ok) reload();
          return result;
        }}
        createLabel="Tambah Paket"
        editLabel="Edit Paket"
        emptyTitle="Belum ada paket"
        emptyDescription="Tambahkan paket (varian pembelian) untuk sebuah produk."
        loading={loading}
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Cari paket…"
        sort={sort}
        onSortToggle={toggleSort}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
          itemLabel: "paket",
        }}
      />
    </div>
  );
}

"use client";

import { useCallback } from "react";
import { listPromoCodesPaged } from "@/app/actions/admin";
import { deleteAdminEntity } from "@/app/actions/admin-crud";
import type { AdminPromoCodeRow } from "@/types/admin";
import type { AdminListParams } from "@/types/admin-pagination";
import EntityManager from "@/components/admin/EntityManager";
import { adminClass } from "@/components/admin/tokens";
import { useAdminPagedList } from "@/components/admin/useAdminList";

/** Promo codes — the discounts that can be applied on a booking. */
export default function PromosManager() {
  const load = useCallback((params: AdminListParams) => listPromoCodesPaged(params), []);
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
  } = useAdminPagedList<AdminPromoCodeRow>(load);

  const columns = [
    {
      key: "code",
      header: "Kode",
      sortable: true,
      render: (row: AdminPromoCodeRow) => (
        <span className="font-mono text-[12px] font-medium">{row.code}</span>
      ),
    },
    {
      key: "title",
      header: "Judul",
      sortable: true,
      render: (row: AdminPromoCodeRow) => <span>{row.title}</span>,
    },
    {
      key: "value",
      header: "Diskon",
      sortable: true,
      render: (row: AdminPromoCodeRow) =>
        row.type === "fixed" ? (
          <span className="tabular-nums">${(row.value / 100).toFixed(2)}</span>
        ) : (
          <span className="tabular-nums">{row.value}%</span>
        ),
    },
    {
      key: "usedCount",
      header: "Pemakaian",
      className: "text-right",
      sortable: true,
      render: (row: AdminPromoCodeRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">
          {row.usedCount}
          {row.usageLimit != null ? ` / ${row.usageLimit}` : ""}
        </span>
      ),
    },
    {
      key: "active",
      header: "Status",
      className: "text-right",
      sortable: true,
      render: (row: AdminPromoCodeRow) => (
        <span className={`${adminClass.pill} ${row.active ? adminClass.pillOn : adminClass.pillOff}`}>
          {row.active ? "Aktif" : "Nonaktif"}
        </span>
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
        createHref="/admin/catalog/promos/new"
        editHref={(row) => `/admin/catalog/promos/${row.id}`}
        nameOf={(row) => row.code}
        itemLabel="Promo"
        onDelete={async (row, typedName) => {
          const result = await deleteAdminEntity({
            table: "promoCode",
            id: row.id,
            confirmName: typedName,
          });
          if (result.ok) reload();
          return result;
        }}
        createLabel="Tambah Promo"
        editLabel="Edit Promo"
        emptyTitle="Belum ada promo"
        emptyDescription="Buat kode promo untuk memotong harga customer."
        loading={loading}
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Cari kode atau judul…"
        sort={sort}
        onSortToggle={toggleSort}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
          itemLabel: "promo",
        }}
      />
    </div>
  );
}

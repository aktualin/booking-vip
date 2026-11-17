"use client";

import { useCallback } from "react";
import { listAmenitiesPaged } from "@/app/actions/admin";
import { deleteAdminEntity } from "@/app/actions/admin-crud";
import type { AdminAmenityRow } from "@/types/admin";
import type { AdminListParams } from "@/types/admin-pagination";
import EntityManager from "@/components/admin/EntityManager";
import { adminClass } from "@/components/admin/tokens";
import { useAdminPagedList } from "@/components/admin/useAdminList";

/** Amenity table — the shared feature list attached to products. */
export default function AmenitiesManager() {
  const load = useCallback((params: AdminListParams) => listAmenitiesPaged(params), []);
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
  } = useAdminPagedList<AdminAmenityRow>(load);

  const columns = [
    {
      key: "label",
      header: "Amenity",
      sortable: true,
      render: (row: AdminAmenityRow) => <span className="font-medium">{row.label}</span>,
    },
    {
      key: "products",
      header: "Dipakai Produk",
      className: "text-right",
      render: (row: AdminAmenityRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">{row.productCount}</span>
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
        createHref="/admin/catalog/amenities/new"
        editHref={(row) => `/admin/catalog/amenities/${row.id}`}
        nameOf={(row) => row.label}
        itemLabel="Amenity"
        onDelete={async (row, typedName) => {
          const result = await deleteAdminEntity({
            table: "amenity",
            id: row.id,
            confirmName: typedName,
          });
          if (result.ok) reload();
          return result;
        }}
        createLabel="Tambah Amenity"
        editLabel="Edit Amenity"
        emptyTitle="Belum ada amenity"
        emptyDescription="Tambahkan fitur yang bisa dipilih produk."
        loading={loading}
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Cari amenity…"
        sort={sort}
        onSortToggle={toggleSort}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
          itemLabel: "amenity",
        }}
      />
    </div>
  );
}

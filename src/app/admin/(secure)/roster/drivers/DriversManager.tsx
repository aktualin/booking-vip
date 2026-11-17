"use client";

import { useCallback } from "react";
import { listAdminDriversPaged, upsertDriver } from "@/app/actions/admin-tour";
import { deleteAdminEntity } from "@/app/actions/admin-crud";
import type { AdminDriverRow } from "@/types/admin";
import type { AdminListParams } from "@/types/admin-pagination";
import EntityManager from "@/components/admin/EntityManager";
import StatusToggle from "@/components/admin/StatusToggle";
import { adminClass } from "@/components/admin/tokens";
import { useAdminPagedList } from "@/components/admin/useAdminList";

/** Driver roster table — the drivers / guides assigned to tour bookings. */
export default function DriversManager() {
  const load = useCallback((params: AdminListParams) => listAdminDriversPaged(params), []);
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
  } = useAdminPagedList<AdminDriverRow>(load);

  const columns = [
    {
      key: "name",
      header: "Driver",
      sortable: true,
      render: (row: AdminDriverRow) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.name}</div>
          <div className="truncate text-[11px] text-[var(--admin-muted)]">{row.phone}</div>
        </div>
      ),
    },
    {
      key: "languages",
      header: "Bahasa",
      sortable: true,
      render: (row: AdminDriverRow) => (
        <span className="text-[12px] text-[var(--admin-muted)]">{row.languages ?? "—"}</span>
      ),
    },
    {
      key: "sortOrder",
      header: "Urutan",
      className: "text-right",
      sortable: true,
      render: (row: AdminDriverRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">{row.sortOrder}</span>
      ),
    },
    {
      key: "active",
      header: "Status",
      className: "w-[70px]",
      sortable: true,
      render: (row: AdminDriverRow) => (
        <StatusToggle
          active={row.active}
          onChange={async (next) => {
            await upsertDriver({ ...row, active: next });
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
        createHref="/admin/roster/drivers/new"
        editHref={(row) => `/admin/roster/drivers/${row.id}`}
        nameOf={(row) => row.name}
        itemLabel="Driver"
        onDelete={async (row, typedName) => {
          const result = await deleteAdminEntity({
            table: "driver",
            id: row.id,
            confirmName: typedName,
          });
          if (result.ok) reload();
          return result;
        }}
        createLabel="Tambah Driver"
        editLabel="Edit Driver"
        emptyTitle="Belum ada driver"
        emptyDescription="Tambahkan driver / guide yang bisa ditugaskan ke booking tour."
        loading={loading}
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Cari driver, telepon, bahasa…"
        sort={sort}
        onSortToggle={toggleSort}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
          itemLabel: "driver",
        }}
      />
    </div>
  );
}

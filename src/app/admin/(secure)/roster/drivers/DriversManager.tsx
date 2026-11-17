"use client";

import { useCallback } from "react";
import { listAdminDrivers, upsertDriver } from "@/app/actions/admin-tour";
import { deleteAdminEntity } from "@/app/actions/admin-crud";
import type { AdminDriverRow } from "@/types/admin";
import EntityManager from "@/components/admin/EntityManager";
import StatusToggle from "@/components/admin/StatusToggle";
import { adminClass } from "@/components/admin/tokens";
import { useAdminList } from "@/components/admin/useAdminList";

/** Driver roster table — the drivers / guides assigned to tour bookings. */
export default function DriversManager() {
  const load = useCallback(() => listAdminDrivers(), []);
  const { rows, loading, error, reload } = useAdminList<AdminDriverRow>(load);

  const columns = [
    {
      key: "name",
      header: "Driver",
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
      render: (row: AdminDriverRow) => (
        <span className="text-[12px] text-[var(--admin-muted)]">{row.languages ?? "—"}</span>
      ),
    },
    {
      key: "order",
      header: "Urutan",
      className: "text-right",
      render: (row: AdminDriverRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">{row.sortOrder}</span>
      ),
    },
    {
      key: "active",
      header: "Status",
      className: "w-[70px]",
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
      />
    </div>
  );
}

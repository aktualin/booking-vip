"use client";

import { useCallback } from "react";
import { listAdminVehicles, upsertVehicle } from "@/app/actions/admin-tour";
import { deleteAdminEntity } from "@/app/actions/admin-crud";
import type { AdminVehicleRow } from "@/types/admin";
import EntityManager from "@/components/admin/EntityManager";
import StatusToggle from "@/components/admin/StatusToggle";
import { adminClass } from "@/components/admin/tokens";
import { useAdminList } from "@/components/admin/useAdminList";

/** Vehicle roster table — the cars / vans assigned to tour bookings. */
export default function VehiclesManager() {
  const load = useCallback(() => listAdminVehicles(), []);
  const { rows, loading, error, reload } = useAdminList<AdminVehicleRow>(load);

  const columns = [
    {
      key: "name",
      header: "Kendaraan",
      render: (row: AdminVehicleRow) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.name}</div>
          <div className="truncate text-[11px] text-[var(--admin-muted)]">
            {row.plateNumber ?? "Tanpa plat"}
          </div>
        </div>
      ),
    },
    {
      key: "seats",
      header: "Kursi",
      className: "text-right",
      render: (row: AdminVehicleRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">{row.seats}</span>
      ),
    },
    {
      key: "order",
      header: "Urutan",
      className: "text-right",
      render: (row: AdminVehicleRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">{row.sortOrder}</span>
      ),
    },
    {
      key: "active",
      header: "Status",
      className: "w-[70px]",
      render: (row: AdminVehicleRow) => (
        <StatusToggle
          active={row.active}
          onChange={async (next) => {
            await upsertVehicle({ ...row, active: next });
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
        createHref="/admin/roster/vehicles/new"
        editHref={(row) => `/admin/roster/vehicles/${row.id}`}
        nameOf={(row) => row.name}
        itemLabel="Kendaraan"
        onDelete={async (row, typedName) => {
          const result = await deleteAdminEntity({
            table: "vehicle",
            id: row.id,
            confirmName: typedName,
          });
          if (result.ok) reload();
          return result;
        }}
        createLabel="Tambah Vehicle"
        editLabel="Edit Vehicle"
        emptyTitle="Belum ada kendaraan"
        emptyDescription="Tambahkan mobil / van yang bisa ditugaskan ke booking tour."
        loading={loading}
      />
    </div>
  );
}

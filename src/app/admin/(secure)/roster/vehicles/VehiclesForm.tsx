"use client";

import { useCallback, useMemo } from "react";
import { listAdminVehicles } from "@/app/actions/admin-tour";
import type { AdminVehicleRow } from "@/types/admin";
import EntityFormPage from "@/components/admin/EntityFormPage";
import type { FieldSpec, FieldValues } from "@/components/admin/fields";
import { useAdminRow } from "@/components/admin/useAdminList";

const LIST_PATH = "/admin/roster/vehicles";

const getKey = (row: AdminVehicleRow) => row.id;

/**
 * The vehicle form — shared by the create page and the edit page.
 *
 * Vehicles are the operator roster assigned to tour bookings; the seat
 * count caps how many passengers one unit can carry.
 */
export default function VehiclesForm({
  mode,
  id,
}: {
  mode: "create" | "edit";
  id?: string;
}) {
  const load = useCallback(() => listAdminVehicles(), []);
  const { row, loading: rowLoading, error: rowError, missing } = useAdminRow<AdminVehicleRow>(
    id,
    load,
    getKey
  );

  const fields = useMemo<FieldSpec[]>(
    () => [
      { name: "name", label: "Nama Kendaraan", kind: "text", wide: true, hint: "Contoh: Toyota Innova Reborn" },
      { name: "plateNumber", label: "Nomor Plat", kind: "text", hint: "Contoh: DK 1234 AB" },
      { name: "seats", label: "Jumlah Kursi", kind: "number", hint: "Kapasitas penumpang per unit" },
      { name: "photoUrl", label: "URL Foto", kind: "text", wide: true },
      { name: "notes", label: "Catatan", kind: "textarea", wide: true },
      { name: "sortOrder", label: "Urutan", kind: "number" },
      { name: "active", label: "Aktif", kind: "toggle" },
    ],
    []
  );

  const initialValues = useMemo<FieldValues>(
    () => ({
      name: row?.name ?? "",
      plateNumber: row?.plateNumber ?? "",
      seats: row?.seats ?? 6,
      photoUrl: row?.photoUrl ?? "",
      notes: row?.notes ?? "",
      sortOrder: row?.sortOrder ?? 0,
      active: row?.active ?? true,
    }),
    [row]
  );

  return (
    <EntityFormPage
      table="vehicle"
      id={id}
      title={mode === "edit" ? "Edit Vehicle" : "Tambah Vehicle"}
      subtitle="Mobil / van yang bisa ditugaskan ke booking tour."
      listPath={LIST_PATH}
      listLabel="Vehicle"
      fields={fields}
      initialValues={initialValues}
      loading={rowLoading}
      loadError={rowError}
      rowMissing={missing}
      entityName={row?.name ?? null}
    />
  );
}

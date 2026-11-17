"use client";

import { useCallback, useMemo } from "react";
import { listAdminDrivers } from "@/app/actions/admin-tour";
import type { AdminDriverRow } from "@/types/admin";
import EntityFormPage from "@/components/admin/EntityFormPage";
import type { FieldSpec, FieldValues } from "@/components/admin/fields";
import { useAdminRow } from "@/components/admin/useAdminList";

const LIST_PATH = "/admin/roster/drivers";

const getKey = (row: AdminDriverRow) => row.id;

/**
 * The driver form — shared by the create page and the edit page.
 *
 * Drivers are the operator roster assigned to tour bookings; the WhatsApp
 * number uses the international format (62…).
 */
export default function DriversForm({
  mode,
  id,
}: {
  mode: "create" | "edit";
  id?: string;
}) {
  const load = useCallback(() => listAdminDrivers(), []);
  const { row, loading: rowLoading, error: rowError, missing } = useAdminRow<AdminDriverRow>(
    id,
    load,
    getKey
  );

  const fields = useMemo<FieldSpec[]>(
    () => [
      { name: "name", label: "Nama", kind: "text", wide: true, hint: "Contoh: Wayan Sudarta" },
      {
        name: "phone",
        label: "WhatsApp",
        kind: "text",
        hint: "Format internasional, contoh 6281234567890",
      },
      { name: "languages", label: "Bahasa", kind: "text", hint: "Contoh: ID, EN" },
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
      phone: row?.phone ?? "",
      languages: row?.languages ?? "",
      photoUrl: row?.photoUrl ?? "",
      notes: row?.notes ?? "",
      sortOrder: row?.sortOrder ?? 0,
      active: row?.active ?? true,
    }),
    [row]
  );

  return (
    <EntityFormPage
      table="driver"
      id={id}
      title={mode === "edit" ? "Edit Driver" : "Tambah Driver"}
      subtitle="Driver / guide yang bisa ditugaskan ke booking tour."
      listPath={LIST_PATH}
      listLabel="Driver"
      fields={fields}
      initialValues={initialValues}
      loading={rowLoading}
      loadError={rowError}
      rowMissing={missing}
      entityName={row?.name ?? null}
    />
  );
}

"use client";

import { useCallback, useMemo } from "react";
import { getAdminReferenceData, listPackages } from "@/app/actions/admin";
import type { AdminPackageRow, AdminReferenceData } from "@/types/admin";
import EntityFormPage from "@/components/admin/EntityFormPage";
import type { FieldSpec, FieldValues } from "@/components/admin/fields";
import { useAdminRow, useAdminValue } from "@/components/admin/useAdminList";

const LIST_PATH = "/admin/catalog/packages";

const getKey = (row: AdminPackageRow) => row.id;

/**
 * The package form — shared by the create page and the edit page.
 *
 * A package is a purchasable variant of a product ("per pax" or "per unit"),
 * so the product picker and the price fields follow the unit kind.
 */
export default function PackagesForm({
  mode,
  id,
}: {
  mode: "create" | "edit";
  id?: string;
}) {
  const load = useCallback(() => listPackages(), []);
  const { row, loading: rowLoading, error: rowError, missing } = useAdminRow<AdminPackageRow>(
    id,
    load,
    getKey
  );

  const reference = useCallback(() => getAdminReferenceData(), []);
  const { data: refs, loading: refsLoading } = useAdminValue<AdminReferenceData>(reference);

  const fields = useMemo<FieldSpec[]>(
    () => [
      { name: "label", label: "Label", kind: "text", hint: "Contoh: Regular" },
      { name: "productId", label: "Produk", kind: "select", options: refs?.products ?? [] },
      {
        name: "unitKind",
        label: "Jenis Unit",
        kind: "select",
        options: [
          { value: "per_pax", label: "Per Pax" },
          { value: "per_unit", label: "Per Unit" },
          { value: "per_day", label: "Per Hari (sewa mobil)" },
        ],
      },
      { name: "adultUsdCents", label: "Harga Dewasa", kind: "money" },
      { name: "childUsdCents", label: "Harga Anak", kind: "money" },
      { name: "infantUsdCents", label: "Harga Bayi", kind: "money" },
      { name: "unitUsdCents", label: "Harga Unit", kind: "money" },
      { name: "durationHours", label: "Durasi (jam)", kind: "number" },
      { name: "extraHourUsdCents", label: "Biaya overtime per jam", kind: "money" },
      {
        name: "fromUsdCents",
        label: "Harga Coret (promo)",
        kind: "money",
        hint: "Harga asal yang dicoret — kosongkan bila tidak ada promo",
      },
      { name: "description", label: "Deskripsi Paket", kind: "textarea", wide: true },
      {
        name: "descriptionId",
        label: "Deskripsi Paket (ID)",
        kind: "textarea",
        wide: true,
        hint: "Kosongkan untuk memakai deskripsi EN",
      },
      {
        name: "info",
        label: "Info Paket (key/value)",
        kind: "keyvalue",
        allowExcluded: true,
        wide: true,
        hint: "Centang Excluded untuk biaya yang dibayar langsung ke vendor/sopir",
      },
      { name: "sortOrder", label: "Urutan", kind: "number" },
      { name: "active", label: "Aktif", kind: "toggle" },
    ],
    [refs]
  );

  const initialValues = useMemo<FieldValues>(
    () => ({
      label: row?.label ?? "",
      productId: row?.productId ?? refs?.products[0]?.value ?? "",
      unitKind: row?.unitKind ?? "per_pax",
      adultUsdCents: row?.adultUsdCents ?? null,
      childUsdCents: row?.childUsdCents ?? null,
      infantUsdCents: row?.infantUsdCents ?? null,
      unitUsdCents: row?.unitUsdCents ?? null,
      durationHours: row?.durationHours ?? null,
      extraHourUsdCents: row?.extraHourUsdCents ?? null,
      fromUsdCents: row?.fromUsdCents ?? null,
      description: row?.description ?? "",
      descriptionId: row?.descriptionId ?? "",
      info: row?.info ?? [],
      sortOrder: row?.sortOrder ?? 0,
      active: row?.active ?? true,
    }),
    [row, refs]
  );

  return (
    <EntityFormPage
      table="package"
      id={id}
      title={mode === "edit" ? "Edit Paket" : "Tambah Paket"}
      subtitle="Paket adalah varian pembelian dari sebuah produk."
      listPath={LIST_PATH}
      listLabel="Paket"
      fields={fields}
      initialValues={initialValues}
      loading={rowLoading || refsLoading}
      loadError={rowError}
      rowMissing={missing}
      entityName={row?.label ?? null}
      renderPreview={(values) =>
        values.unitKind === "per_unit" ? (
          <p className="mt-4 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-[var(--admin-muted)]">
            Harga per mobil/unit — bukan per orang. Untuk tour private, satu paket mencakup
            seluruh mobil hingga kapasitas maksimumnya.
          </p>
        ) : null
      }
    />
  );
}

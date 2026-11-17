"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getTourAdminReferenceData,
  listAdminDepartures,
  upsertTourDeparture,
} from "@/app/actions/admin-tour";
import type { AdminDepartureRow } from "@/types/admin";
import { ChevronLeft } from "@/components/icons";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";
import { useAdminRow, useAdminValue } from "@/components/admin/useAdminList";

const LIST_PATH = "/admin/tour-departures";

const STATUS_OPTIONS = [
  { value: "open", label: "Open — bisa dipesan" },
  { value: "closed", label: "Closed — ditutup" },
  { value: "cancelled", label: "Cancelled — dibatalkan" },
];

const getKey = (row: AdminDepartureRow) => row.id;

/**
 * The departure form — create / edit a join-in schedule.
 *
 * A custom form (not the generic EntityFormPage) because the schedule needs
 * native date / time pickers and the product picker is scoped to the tour
 * line. Saving goes straight to `upsertTourDeparture`, which answers with a
 * field-aware structured result.
 */
export default function DeparturesForm({
  mode,
  id,
}: {
  mode: "create" | "edit";
  id?: string;
}) {
  const router = useRouter();

  const loadReference = useCallback(() => getTourAdminReferenceData(), []);
  const { data: reference } = useAdminValue(loadReference);

  const loadRows = useCallback(() => listAdminDepartures(), []);
  const { row, loading: rowLoading, missing } = useAdminRow<AdminDepartureRow>(
    id,
    loadRows,
    getKey,
  );

  const [productId, setProductId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [quota, setQuota] = useState(10);
  const [status, setStatus] = useState("open");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Initialise from the row once it loads (edit mode).
  useEffect(() => {
    if (!row) return;
    setProductId(row.productId);
    setDate(row.date.slice(0, 10));
    setStartTime(row.startTime);
    setQuota(row.quota);
    setStatus(row.status);
    setNotes(row.notes ?? "");
  }, [row]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      const result = await upsertTourDeparture({
        id,
        productId,
        date,
        startTime,
        quota,
        status,
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        if (result.field) setFieldErrors({ [result.field]: result.error });
        return;
      }
      showAdminToast(result.message);
      router.push(LIST_PATH);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan jadwal");
    } finally {
      setSaving(false);
    }
  };

  if (rowLoading) {
    return (
      <div className="rounded-lg border border-[var(--admin-line)] px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]">
        Memuat data…
      </div>
    );
  }

  if (mode === "edit" && missing) {
    return (
      <div className="rounded-lg border border-[var(--admin-line)] px-6 py-12 text-center">
        <p className="text-[13px] font-medium">Jadwal tidak ditemukan</p>
        <Link href={LIST_PATH} className={`${adminClass.buttonSecondary} mt-4`}>
          Kembali ke Departure Tour
        </Link>
      </div>
    );
  }

  const fieldError = (name: string) =>
    fieldErrors[name] ? (
      <p className="mt-1 text-[12px] text-danger">{fieldErrors[name]}</p>
    ) : null;

  return (
    <form onSubmit={handleSubmit} className="pb-6">
      <Link
        href={LIST_PATH}
        className="mb-4 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--admin-muted)] transition-colors hover:text-[var(--admin-ink)]"
      >
        <ChevronLeft width={14} height={14} />
        Kembali ke Departure Tour
      </Link>

      <div className="mb-5">
        <h1 className={adminClass.h1}>
          {mode === "edit" ? "Edit Jadwal Keberangkatan" : "Tambah Jadwal Keberangkatan"}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
          Jadwal join-in untuk produk tour. Kuota adalah total kursi yang dijual pada tanggal ini.
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      <div className={`${adminClass.panel} p-5 sm:p-6`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={adminClass.label} htmlFor="dep-product">
              Produk Tour
            </label>
            <select
              id="dep-product"
              className={`${adminClass.input} mt-1`}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">— Pilih produk tour —</option>
              {(reference?.tourProducts ?? []).map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {fieldError("productId")}
          </div>

          <div>
            <label className={adminClass.label} htmlFor="dep-date">
              Tanggal
            </label>
            <input
              id="dep-date"
              type="date"
              className={`${adminClass.input} mt-1`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {fieldError("date")}
          </div>

          <div>
            <label className={adminClass.label} htmlFor="dep-time">
              Jam Mulai
            </label>
            <input
              id="dep-time"
              type="time"
              className={`${adminClass.input} mt-1`}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
            {fieldError("startTime")}
          </div>

          <div>
            <label className={adminClass.label} htmlFor="dep-quota">
              Kuota Kursi
            </label>
            <input
              id="dep-quota"
              type="number"
              min={1}
              max={99}
              step={1}
              className={`${adminClass.input} mt-1 tabular-nums`}
              value={quota}
              onChange={(e) => setQuota(Math.trunc(Number(e.target.value)))}
            />
            {fieldError("quota")}
          </div>

          <div>
            <label className={adminClass.label} htmlFor="dep-status">
              Status
            </label>
            <select
              id="dep-status"
              className={`${adminClass.input} mt-1`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {fieldError("status")}
          </div>

          <div className="sm:col-span-2">
            <label className={adminClass.label} htmlFor="dep-notes">
              Catatan
            </label>
            <textarea
              id="dep-notes"
              rows={3}
              className={`${adminClass.input} mt-1 h-auto py-2`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Mis. titik kumpul, instruksi khusus…"
            />
          </div>
        </div>

        {mode === "edit" && row ? (
          <p className="mt-4 text-[12px] text-[var(--admin-muted)]">
            Kursi terisi saat ini: <span className="tabular-nums font-medium">{row.reserved}</span> dari{" "}
            <span className="tabular-nums">{row.quota}</span> — kuota tidak boleh lebih kecil dari kursi terisi.
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 z-40 mt-5 flex items-center justify-end gap-2 border-t border-[var(--admin-line)] bg-white py-3">
        <Link href={LIST_PATH} className={adminClass.buttonSecondary}>
          Batal
        </Link>
        <button type="submit" disabled={saving} className={adminClass.buttonPrimary}>
          {saving ? "Menyimpan…" : id ? "Simpan Perubahan" : "Simpan"}
        </button>
      </div>
    </form>
  );
}

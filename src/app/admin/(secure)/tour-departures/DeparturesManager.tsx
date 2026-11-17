"use client";

import { useCallback, useState } from "react";
import {
  getTourAdminReferenceData,
  listAdminDepartures,
  setDepartureStatus,
} from "@/app/actions/admin-tour";
import { deleteAdminEntity } from "@/app/actions/admin-crud";
import type { AdminDepartureRow } from "@/types/admin";
import EntityManager from "@/components/admin/EntityManager";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";
import { useAdminList, useAdminValue } from "@/components/admin/useAdminList";
import { formatDateLabel } from "@/lib/format";

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_TONES: Record<string, string> = {
  open: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-amber-200 bg-amber-50 text-amber-700",
  cancelled: "border-red-200 bg-red-50 text-red-600",
};

/** The join-in departure schedule with live seat availability. */
export default function DeparturesManager() {
  const [productFilter, setProductFilter] = useState("");

  const loadReference = useCallback(() => getTourAdminReferenceData(), []);
  const { data: reference } = useAdminValue(loadReference);

  const load = useCallback(
    () => listAdminDepartures(productFilter || undefined),
    [productFilter],
  );
  const { rows, loading, error, reload } = useAdminList<AdminDepartureRow>(load);

  const changeStatus = async (row: AdminDepartureRow, status: string) => {
    const result = await setDepartureStatus({ id: row.id, status });
    if (result.ok) {
      showAdminToast(result.message);
      reload();
    } else {
      showAdminToast(result.error, "error");
    }
  };

  const columns = [
    {
      key: "date",
      header: "Tanggal",
      render: (row: AdminDepartureRow) => (
        <span className="tabular-nums font-medium">{formatDateLabel(row.date.slice(0, 10))}</span>
      ),
    },
    {
      key: "startTime",
      header: "Jam",
      render: (row: AdminDepartureRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">{row.startTime}</span>
      ),
    },
    {
      key: "product",
      header: "Produk Tour",
      render: (row: AdminDepartureRow) => <span>{row.productTitle}</span>,
    },
    {
      key: "quota",
      header: "Kuota",
      className: "text-right",
      render: (row: AdminDepartureRow) => (
        <span className="tabular-nums text-[var(--admin-muted)]">{row.quota}</span>
      ),
    },
    {
      key: "reserved",
      header: "Terisi",
      className: "text-right",
      render: (row: AdminDepartureRow) => (
        <span className="tabular-nums">{row.reserved}</span>
      ),
    },
    {
      key: "available",
      header: "Sisa",
      className: "text-right",
      render: (row: AdminDepartureRow) =>
        row.available <= 0 ? (
          <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
            Habis
          </span>
        ) : (
          <span className="tabular-nums font-medium">{row.available}</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      className: "w-[130px]",
      render: (row: AdminDepartureRow) => (
        <select
          value={row.status}
          onChange={(e) => changeStatus(row, e.target.value)}
          aria-label={`Status jadwal ${row.productTitle}`}
          className={`h-8 rounded-lg border px-2 text-[12px] font-medium outline-none ${STATUS_TONES[row.status] ?? STATUS_TONES.open}`}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className={adminClass.h1}>Departure Tour</h2>
        <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
          Jadwal keberangkatan join-in per produk tour. Kursi terisi dihitung otomatis dari
          booking aktif — tidak perlu diubah manual.
        </p>
      </div>

      {error ? (
        <p className={`${adminClass.panel} mb-4 px-3 py-2 text-[12px] text-danger`}>{error}</p>
      ) : null}

      <EntityManager
        rows={rows}
        columns={columns}
        getKey={(row) => row.id}
        createHref="/admin/tour-departures/new"
        editHref={(row) => `/admin/tour-departures/${row.id}`}
        nameOf={(row) =>
          `${row.productTitle} · ${row.date.slice(0, 10)} ${row.startTime}`
        }
        itemLabel="Jadwal keberangkatan"
        onDelete={async (row, typedName) => {
          const result = await deleteAdminEntity({
            table: "tourDeparture",
            id: row.id,
            confirmName: typedName,
          });
          if (result.ok) reload();
          return result;
        }}
        createLabel="Tambah Jadwal"
        editLabel="Edit Jadwal"
        emptyTitle="Belum ada jadwal keberangkatan"
        emptyDescription="Tambahkan jadwal join-in untuk produk tour agar bisa dipesan per tanggal."
        loading={loading}
        headerExtra={
          <select
            className={`${adminClass.input} w-auto min-w-[220px]`}
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            aria-label="Filter produk tour"
          >
            <option value="">Semua produk tour</option>
            {(reference?.tourProducts ?? []).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        }
      />
    </div>
  );
}

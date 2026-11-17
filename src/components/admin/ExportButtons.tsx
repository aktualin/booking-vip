"use client";

import { useState } from "react";
import type { AdminExportTable } from "@/types/admin";
import { downloadCsv, downloadXlsx } from "@/lib/admin/download";
import { adminClass } from "./tokens";
import { showAdminToast } from "./toast";

/**
 * The CSV / Excel export pair shared by the admin transaction tables.
 *
 * `load` is the server action call that builds the flat export table from
 * the manager's *current* filters; the buttons turn it into a download
 * (CSV straight away, XLSX through the lazily-imported SheetJS bundle).
 */
export default function ExportButtons({
  load,
  disabled,
}: {
  load: () => Promise<
    { ok: true; table: AdminExportTable } | { ok: false; error: string }
  >;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<"" | "csv" | "xlsx">("");

  const run = async (format: "csv" | "xlsx") => {
    if (busy) return;
    setBusy(format);
    try {
      const result = await load();
      if (!result.ok) {
        showAdminToast(result.error, "error");
        return;
      }
      if (format === "csv") downloadCsv(result.table);
      else await downloadXlsx(result.table);
      showAdminToast(format === "csv" ? "CSV diunduh." : "Excel diunduh.");
    } catch (err) {
      showAdminToast(
        err instanceof Error ? err.message : "Gagal mengekspor data",
        "error",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => run("csv")}
        disabled={disabled || busy !== ""}
        className={adminClass.buttonSecondary}
        title="Unduh tabel ini sebagai CSV (sesuai filter aktif)"
      >
        {busy === "csv" ? "Mengekspor…" : "Export CSV"}
      </button>
      <button
        type="button"
        onClick={() => run("xlsx")}
        disabled={disabled || busy !== ""}
        className={adminClass.buttonSecondary}
        title="Unduh tabel ini sebagai Excel .xlsx (sesuai filter aktif)"
      >
        {busy === "xlsx" ? "Mengekspor…" : "Export Excel"}
      </button>
    </div>
  );
}

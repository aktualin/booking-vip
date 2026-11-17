/**
 * Client-side table downloads for the admin area.
 *
 * The server actions build a flat `AdminExportTable` (header + rows) from
 * the filtered query; these helpers turn it into an actual file:
 *   - CSV  — plain text, semicolon-free, UTF-8 with a BOM so Excel opens
 *            it with the right encoding;
 *   - XLSX — through SheetJS (`xlsx`), dynamically imported so the library
 *            stays out of the initial admin bundle.
 *
 * Plain module (no "use server", no server-only import) — browser only.
 */

import type { AdminExportTable } from "@/types/admin";

/** Escape one CSV cell — quotes doubled, always quoted. */
function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Download the table as a UTF-8 CSV file (Excel-compatible). */
export function downloadCsv(table: AdminExportTable): void {
  const lines = [table.header, ...table.rows].map((row) =>
    row.map(csvCell).join(","),
  );
  // \ufeff = BOM — makes Excel detect UTF-8.
  const blob = new Blob([`\ufeff${lines.join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  saveBlob(blob, `${table.filename}.csv`);
}

/** Download the table as a real .xlsx workbook (SheetJS). */
export async function downloadXlsx(table: AdminExportTable): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([table.header, ...table.rows]);
  // Reasonable column widths from the header labels.
  sheet["!cols"] = table.header.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, table.sheetName.slice(0, 31));
  const out = XLSX.write(book, { bookType: "xlsx", type: "array" });
  saveBlob(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${table.filename}.xlsx`,
  );
}

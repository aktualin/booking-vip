"use client";

import { useRef, useState } from "react";
import { EVOA_DOC_SLOTS, type EvoaFileRef } from "@/lib/evoa-shared";
import { uploadEvoaDoc } from "@/lib/evoa-upload";
import { showToast } from "@/components/ui/toast";
import { formatBytes, type Lang } from "./shared";

/**
 * The four standard document slots of one applicant (passport page, photo,
 * ticket, optional hotel). Files upload immediately via uploadEvoaDoc; the
 * wizard only keeps the returned references. Per-file state is shown inline:
 * uploading → done (in the list) or error (dismissible, retry by re-picking).
 */

type PendingFile = {
  id: number;
  fileName: string;
  status: "uploading" | "error";
  error?: string;
};

let nextPendingId = 1;

type Props = {
  documents: Record<string, EvoaFileRef[]>;
  onChange: (slot: string, refs: EvoaFileRef[]) => void;
  lang: Lang;
  disabled?: boolean;
  /** Slot a validation error points at (red highlight). */
  errorSlot?: string;
};

export default function DocumentsUpload({ documents, onChange, lang, disabled, errorSlot }: Props) {
  const t = (en: string, id: string) => (lang === "id" ? id : en);
  const [pending, setPending] = useState<Record<string, PendingFile[]>>({});

  // Mirror the latest refs so a sequential upload loop never appends to a
  // stale array when the parent re-renders between uploads.
  const docsRef = useRef(documents);
  docsRef.current = documents;

  const addPending = (slot: string, entry: PendingFile) =>
    setPending((p) => ({ ...p, [slot]: [...(p[slot] ?? []), entry] }));
  const patchPending = (slot: string, id: number, patch: Partial<PendingFile>) =>
    setPending((p) => ({
      ...p,
      [slot]: (p[slot] ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
  const dropPending = (slot: string, id: number) =>
    setPending((p) => ({ ...p, [slot]: (p[slot] ?? []).filter((entry) => entry.id !== id) }));

  const handleFiles = async (slot: string, maxFiles: number, list: FileList | null, input: HTMLInputElement | null) => {
    if (!list || list.length === 0 || disabled) return;
    const selected = Array.from(list);
    // Allow re-selecting the same file after a remove/error.
    if (input) input.value = "";

    const current = [...(docsRef.current[slot] ?? [])];
    for (const file of selected) {
      const uploading = (pending[slot] ?? []).filter((p) => p.status === "uploading").length;
      if (current.length + uploading >= maxFiles) {
        showToast(
          t(`Maximum ${maxFiles} file(s) for this document.`, `Maksimal ${maxFiles} file untuk dokumen ini.`),
          "error",
        );
        break;
      }
      const id = nextPendingId++;
      addPending(slot, { id, fileName: file.name, status: "uploading" });
      try {
        const result = await uploadEvoaDoc(file, slot);
        if (result.ok) {
          current.push({
            key: result.key,
            url: result.url,
            fileName: result.fileName,
            mimeType: result.mimeType,
            sizeBytes: result.sizeBytes,
          });
          onChange(slot, [...current]);
          dropPending(slot, id);
        } else {
          patchPending(slot, id, { status: "error", error: result.error });
          showToast(result.error, "error");
        }
      } catch {
        const message = t("Upload failed. Try again.", "Gagal mengunggah. Coba lagi.");
        patchPending(slot, id, { status: "error", error: message });
        showToast(message, "error");
      }
    }
  };

  return (
    <div className="grid gap-4">
      {EVOA_DOC_SLOTS.map((slotDef) => {
        const files = documents[slotDef.slot] ?? [];
        const slotPending = pending[slotDef.slot] ?? [];
        const uploadingCount = slotPending.filter((p) => p.status === "uploading").length;
        const full = files.length + uploadingCount >= slotDef.maxFiles;
        const errored = errorSlot === slotDef.slot;

        return (
          <div
            key={slotDef.slot}
            className={`rounded-xl border p-3.5 ${errored ? "border-danger/40 bg-danger/5" : "border-line bg-canvas/50"}`}
          >
            <p className={`text-[12px] font-semibold ${errored ? "text-danger" : "text-ink"}`}>
              {lang === "id" ? slotDef.id : slotDef.en}
              {slotDef.required ? <span className="text-danger"> *</span> : null}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              {lang === "id" ? slotDef.helpId : slotDef.helpEn}
            </p>

            <input
              type="file"
              accept={slotDef.accept.join(",")}
              multiple={slotDef.maxFiles > 1}
              disabled={disabled || full}
              onChange={(e) => void handleFiles(slotDef.slot, slotDef.maxFiles, e.target.files, e.currentTarget)}
              className="mt-2 block w-full cursor-pointer rounded-xl border border-dashed border-line bg-white px-3 py-2.5 text-[12px] text-muted transition-colors file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-white hover:border-brand disabled:cursor-not-allowed disabled:opacity-60"
            />

            {files.length > 0 || slotPending.length > 0 ? (
              <ul className="mt-2 grid gap-1.5">
                {files.map((file) => (
                  <li
                    key={file.key}
                    className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2"
                  >
                    <svg className="h-3.5 w-3.5 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                      {file.fileName}
                      <span className="ml-1.5 text-muted">{formatBytes(file.sizeBytes)}</span>
                    </span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(slotDef.slot, files.filter((f) => f.key !== file.key))}
                      className="shrink-0 text-[12px] font-medium text-muted transition-colors hover:text-danger disabled:opacity-50"
                    >
                      {t("Remove", "Hapus")}
                    </button>
                  </li>
                ))}
                {slotPending.map((entry) => (
                  <li
                    key={entry.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                      entry.status === "error" ? "border-danger/30 bg-danger/5" : "border-line bg-white"
                    }`}
                  >
                    {entry.status === "uploading" ? (
                      <svg className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <span className="shrink-0 text-[12px] font-bold text-danger" aria-hidden="true">!</span>
                    )}
                    <span className={`min-w-0 flex-1 truncate text-[12px] ${entry.status === "error" ? "text-danger" : "text-muted"}`}>
                      {entry.fileName}
                      {entry.status === "uploading"
                        ? ` — ${t("Uploading…", "Mengunggah…")}`
                        : ` — ${entry.error ?? t("Upload failed.", "Gagal diunggah.")}`}
                    </span>
                    {entry.status === "error" ? (
                      <button
                        type="button"
                        onClick={() => dropPending(slotDef.slot, entry.id)}
                        className="shrink-0 text-[12px] font-medium text-muted transition-colors hover:text-danger"
                      >
                        {t("Dismiss", "Tutup")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
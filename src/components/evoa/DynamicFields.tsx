"use client";

import { useRef, useState, type JSX } from "react";
import {
  evoaFieldVisible,
  type EvoaAnswers,
  type EvoaFieldDefDTO,
  type EvoaFileRef,
} from "@/lib/evoa-shared";
import { uploadEvoaDoc } from "@/lib/evoa-upload";
import { showToast } from "@/components/ui/toast";

/**
 * Renders the admin-defined dynamic fields of one scope on top of the
 * standard e-VOA form. The wizard owns the answers map; this component is
 * a pure renderer + upload handler and never validates on its own — the
 * shared `validateEvoaAnswers` runs on submit (client and server).
 */

type Props = {
  /** Already filtered to one scope by the caller. */
  defs: EvoaFieldDefDTO[];
  answers: EvoaAnswers;
  onChange: (key: string, value: string | boolean | EvoaFileRef[]) => void;
  /** For showWhen rules that test the order purpose. */
  purpose?: string;
  lang: "en" | "id";
  disabled?: boolean;
};

// Same input styling as the standard form fields (EvoaApplyForm).
const FIELD_CLASS =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

const FILE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

/** Pick the Indonesian variant when available, else fall back to English. */
function pick(lang: "en" | "id", en: string, id: string | null | undefined): string {
  return lang === "id" ? (id ?? en) : en;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function DynamicFields({
  defs,
  answers,
  onChange,
  purpose,
  lang,
  disabled,
}: Props): JSX.Element | null {
  const visible = defs.filter((def) =>
    evoaFieldVisible(def.showWhen, { purpose, answers }),
  );
  if (visible.length === 0) return null;

  const t = (en: string, id: string) => (lang === "id" ? id : en);

  return (
    <div className="grid gap-3.5">
      {visible.map((def) => {
        const label = pick(lang, def.labelEn, def.labelId);
        const help =
          def.helpEn || def.helpId
            ? pick(lang, def.helpEn ?? "", def.helpId)
            : null;
        const value = answers[def.key];

        return (
          <div key={def.id} className="block">
            {def.type !== "checkbox" ? (
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {label}
                {def.required ? <span className="text-danger"> *</span> : null}
              </span>
            ) : null}

            {def.type === "textarea" ? (
              <textarea
                rows={3}
                value={typeof value === "string" ? value : ""}
                placeholder={pick(lang, def.placeholderEn ?? "", def.placeholderId) || undefined}
                disabled={disabled}
                onChange={(e) => onChange(def.key, e.target.value)}
                className={`${FIELD_CLASS} h-auto py-2.5`}
              />
            ) : def.type === "select" ? (
              <select
                value={typeof value === "string" ? value : ""}
                disabled={disabled}
                onChange={(e) => onChange(def.key, e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">{t("Select…", "Pilih…")}</option>
                {def.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {pick(lang, opt.labelEn, opt.labelId)}
                  </option>
                ))}
              </select>
            ) : def.type === "checkbox" ? (
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={value === true}
                  disabled={disabled}
                  onChange={(e) => onChange(def.key, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line accent-brand"
                />
                <span className="text-[13px] leading-snug text-ink">
                  {label}
                  {def.required ? <span className="text-danger"> *</span> : null}
                </span>
              </label>
            ) : def.type === "file" ? (
              <FileField
                def={def}
                files={Array.isArray(value) ? value : []}
                onChange={onChange}
                lang={lang}
                disabled={disabled}
              />
            ) : (
              <input
                type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
                value={typeof value === "string" ? value : ""}
                placeholder={pick(lang, def.placeholderEn ?? "", def.placeholderId) || undefined}
                disabled={disabled}
                onChange={(e) => onChange(def.key, e.target.value)}
                className={FIELD_CLASS}
              />
            )}

            {help ? (
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{help}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* File field                                                          */
/* ------------------------------------------------------------------ */

type PendingUpload = { id: number; fileName: string };
let nextUploadId = 1;

function FileField({
  def,
  files,
  onChange,
  lang,
  disabled,
}: {
  def: EvoaFieldDefDTO;
  files: EvoaFileRef[];
  onChange: Props["onChange"];
  lang: "en" | "id";
  disabled?: boolean;
}) {
  const max = def.maxFiles ?? 1;
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mirror the latest answers so a sequential upload loop never appends to
  // a stale array when the parent re-renders between uploads.
  const filesRef = useRef(files);
  filesRef.current = files;

  const t = (en: string, id: string) => (lang === "id" ? id : en);
  const full = files.length + pending.length >= max;

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0 || disabled) return;
    const selected = Array.from(list);
    // Allow re-selecting the same file after a remove/error.
    if (inputRef.current) inputRef.current.value = "";

    const current = [...filesRef.current];
    for (const file of selected) {
      if (current.length >= max) {
        showToast(
          t(`Maximum ${max} file(s) for this field.`, `Maksimal ${max} file untuk kolom ini.`),
          "error",
        );
        break;
      }
      const uploadId = nextUploadId++;
      setPending((p) => [...p, { id: uploadId, fileName: file.name }]);
      try {
        // The field key doubles as the document slot (see EvoaFormField.key).
        const result = await uploadEvoaDoc(file, def.key);
        if (result.ok) {
          current.push({
            key: result.key,
            url: result.url,
            fileName: result.fileName,
            mimeType: result.mimeType,
            sizeBytes: result.sizeBytes,
          });
          onChange(def.key, [...current]);
        } else {
          showToast(result.error, "error");
        }
      } catch {
        showToast(t("Upload failed. Try again.", "Gagal mengunggah. Coba lagi."), "error");
      } finally {
        setPending((p) => p.filter((entry) => entry.id !== uploadId));
      }
    }
  };

  const remove = (key: string) => {
    onChange(def.key, files.filter((f) => f.key !== key));
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple={max > 1}
        disabled={disabled || full}
        onChange={(e) => void handleFiles(e.target.files)}
        className="block w-full cursor-pointer rounded-xl border border-dashed border-line bg-canvas px-3 py-2.5 text-[12px] text-muted transition-colors file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-white hover:border-brand disabled:cursor-not-allowed disabled:opacity-60"
      />
      <p className="mt-1 text-[11px] text-muted">
        {t(
          `JPG, PNG, WEBP or PDF · max ${max} file(s).`,
          `JPG, PNG, WEBP, atau PDF · maks ${max} file.`,
        )}
      </p>

      {files.length > 0 || pending.length > 0 ? (
        <ul className="mt-2 grid gap-1.5">
          {files.map((f) => (
            <li
              key={f.key}
              className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                {f.fileName}
                <span className="ml-1.5 text-muted">{formatBytes(f.sizeBytes)}</span>
              </span>
              <button
                type="button"
                aria-label={t("Remove file", "Hapus file")}
                disabled={disabled}
                onClick={() => remove(f.key)}
                className="shrink-0 text-[12px] font-medium text-muted transition-colors hover:text-danger disabled:opacity-50"
              >
                {t("Remove", "Hapus")}
              </button>
            </li>
          ))}
          {pending.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 rounded-xl border border-line bg-canvas px-3 py-2"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0 animate-spin text-brand"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                {entry.fileName} — {t("Uploading…", "Mengunggah…")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
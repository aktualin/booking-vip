"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { uploadRenterDoc } from "@/lib/renter-upload";
import { useLocale } from "@/components/providers/LocaleProvider";
import type { DictKey } from "@/i18n";

export type RenterIdentity = {
  identityNumber: string;
  idType: "" | "ktp" | "ssn" | "passport";
  idDocumentUrl: string | null;
};

type Props = {
  value: RenterIdentity;
  onChange: (v: RenterIdentity) => void;
};

/** Client-side pre-check matching the "Maks 8 MB" helper; the server validates too. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Dictionary key for the identity-number label per document type. */
const NUMBER_LABEL_KEY: Record<RenterIdentity["idType"], DictKey> = {
  "": "renter.numberLabel",
  ktp: "renter.numberKtp",
  ssn: "renter.numberSsn",
  passport: "renter.numberPassport",
};

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

const PICKER_BUTTON_CLASS =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Renter identity section for the booking wizard: identity number, document
 * type, and an ID document upload (gallery/file or camera) with preview.
 * Presentational — the wizard owns the value; the only side effect is the
 * upload call via `uploadRenterDoc`.
 */
export default function RenterIdentityForm({ value, onChange }: Props) {
  const { t } = useLocale();
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest value, so a finishing upload never clobbers edits made to the
  // other fields while the file was in flight.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const docUrl = value.idDocumentUrl;
  const isPdf = !!docUrl && docUrl.split("?")[0].toLowerCase().endsWith(".pdf");

  async function uploadFile(file: File | null | undefined) {
    if (!file || uploading) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(t("renter.fileTooLarge"));
      return;
    }
    setError(null);
    setUploading(true);
    const result = await uploadRenterDoc(file, "id");
    setUploading(false);
    if (result.ok) {
      onChange({ ...valueRef.current, idDocumentUrl: result.url });
    } else {
      setError(result.error);
    }
  }

  function handlePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    void uploadFile(file);
  }

  return (
    <section className="mb-6 rounded-2xl border border-line bg-white p-5">
      <h3 className="mb-4 text-base font-bold text-ink">{t("renter.title")}</h3>

      <div className="space-y-4">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink">
              {t(NUMBER_LABEL_KEY[value.idType])}
            </span>
            <input
              type="text"
              value={value.identityNumber}
              onChange={(e) =>
                onChange({ ...value, identityNumber: e.target.value })
              }
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink">
              {t("renter.docType")}
            </span>
            <select
              value={value.idType}
              onChange={(e) =>
                onChange({
                  ...value,
                  idType: e.target.value as RenterIdentity["idType"],
                })
              }
              className={INPUT_CLASS}
            >
              <option value="">{t("renter.docTypePlaceholder")}</option>
              <option value="ktp">{t("renter.docTypeKtp")}</option>
              <option value="ssn">{t("renter.docTypeSsn")}</option>
              <option value="passport">{t("renter.docTypePassport")}</option>
            </select>
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-ink">
            {t("renter.uploadLabel")}
          </span>

          {docUrl ? (
            /* Preview uses the uploaded remote URL directly — no object URLs
               are created, so there is nothing to revoke. */
            <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas/50 p-3">
              {isPdf ? (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-brand">
                  <FileText width={24} height={24} />
                </span>
              ) : (
                <img
                  src={docUrl}
                  alt={t("renter.previewAlt")}
                  className="h-16 w-16 shrink-0 rounded-lg border border-line bg-white object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">
                  {isPdf ? t("renter.pdfUploaded") : t("renter.docUploaded")}
                </p>
                {isPdf ? (
                  <a
                    href={docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-block text-[12px] font-medium text-brand transition-opacity hover:opacity-80"
                  >
                    {t("renter.viewDoc")}
                  </a>
                ) : null}
                {uploading ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted">
                    <Loader2 width={14} height={14} className="animate-spin" />
                    {t("renter.uploading")}
                  </p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink transition-colors hover:bg-canvas"
                    >
                      <Upload width={14} height={14} />
                      {t("renter.replace")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange({ ...value, idDocumentUrl: null })}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/20 bg-white px-3 text-[12px] font-semibold text-danger transition-colors hover:bg-danger/5"
                    >
                      <Trash2 width={14} height={14} />
                      {t("renter.remove")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line bg-canvas/50 p-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={uploading}
                  className={PICKER_BUTTON_CLASS}
                >
                  {uploading ? (
                    <Loader2 width={16} height={16} className="animate-spin" />
                  ) : (
                    <Upload width={16} height={16} />
                  )}
                  {uploading ? t("renter.uploading") : t("renter.gallery")}
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={uploading}
                  className={PICKER_BUTTON_CLASS}
                >
                  <Camera width={16} height={16} />
                  {t("renter.camera")}
                </button>
              </div>
              <p className="mt-2.5 text-[11px] text-muted">
                {t("renter.formatHint")}
              </p>
            </div>
          )}

          {error ? (
            <p
              aria-live="polite"
              className="mt-2 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {/* Hidden pickers: gallery/file (images + PDF) and device camera. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={handlePick}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePick}
        className="hidden"
      />
    </section>
  );
}

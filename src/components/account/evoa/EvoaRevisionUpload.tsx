"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EVOA_DOC_SLOTS,
  evoaDocSlot,
  type EvoaDocumentDTO,
  type EvoaFileRef,
} from "@/lib/evoa-shared";
import { uploadEvoaDoc } from "@/lib/evoa-upload";
import { resubmitEvoaRevision } from "@/app/actions/evoa";
import { showToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/LocaleProvider";
import type { EvoaTrackingFieldDef } from "@/app/actions/evoa-tracking";
import { fmtBytes, pick, slotLabel } from "./shared";

/**
 * The revision re-upload flow.
 *
 * Shown for the scope (one applicant, or the order itself) that ops asked
 * to fix. The customer uploads fresh files per slot — each file goes to R2
 * through the shared upload helper first — then submits the collected
 * references in one `resubmitEvoaRevision` call, which replaces the slot's
 * documents and moves the scope back into review.
 *
 * Which slots are offered: the ones whose documents were flagged "revision"
 * by ops; when nothing is flagged (an order-level note without per-file
 * flags) every standard slot is offered so the customer can fix anything.
 */
export default function EvoaRevisionUpload({
  code,
  applicantId,
  documents,
  fieldDefs = [],
}: {
  code: string;
  /** Null → order-level documents (orderDocuments payload). */
  applicantId: string | null;
  /** The documents of this scope — used to find the flagged slots. */
  documents: EvoaDocumentDTO[];
  fieldDefs?: EvoaTrackingFieldDef[];
}) {
  const { lang } = useLocale();
  const router = useRouter();

  const [refs, setRefs] = useState<Record<string, EvoaFileRef[]>>({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const flagged = [
    ...new Set(
      documents
        .filter((doc) => doc.reviewStatus === "revision")
        .map((doc) => doc.slot),
    ),
  ];
  const slots = flagged.length > 0 ? flagged : EVOA_DOC_SLOTS.map((s) => s.slot);

  const handleFiles = async (slot: string, fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const def = evoaDocSlot(slot);
    const maxFiles = def?.maxFiles ?? 3;
    const current = refs[slot] ?? [];

    setUploadingSlot(slot);
    const added: EvoaFileRef[] = [];
    for (const file of Array.from(fileList)) {
      if (current.length + added.length >= maxFiles) {
        showToast(
          pick(
            lang,
            `Maksimal ${maxFiles} file untuk ${slotLabel(slot, lang, fieldDefs)}.`,
            `Maximum ${maxFiles} file(s) for ${slotLabel(slot, lang, fieldDefs)}.`,
          ),
          "error",
        );
        break;
      }
      const result = await uploadEvoaDoc(file, slot);
      if (result.ok) {
        added.push({
          key: result.key,
          url: result.url,
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
        });
      } else {
        showToast(result.error, "error");
      }
    }
    if (added.length > 0) {
      setRefs((prev) => ({ ...prev, [slot]: [...(prev[slot] ?? []), ...added] }));
    }
    setUploadingSlot(null);
  };

  const removeRef = (slot: string, key: string) => {
    setRefs((prev) => ({
      ...prev,
      [slot]: (prev[slot] ?? []).filter((ref) => ref.key !== key),
    }));
  };

  const handleSubmit = async () => {
    if (submitting || uploadingSlot) return;

    const payloadDocs: Record<string, EvoaFileRef[]> = {};
    for (const [slot, list] of Object.entries(refs)) {
      if (list.length > 0) payloadDocs[slot] = list;
    }
    if (Object.keys(payloadDocs).length === 0) {
      showToast(
        pick(
          lang,
          "Unggah minimal satu file pengganti dulu.",
          "Upload at least one replacement file first.",
        ),
        "error",
      );
      return;
    }

    setSubmitting(true);
    const result = await resubmitEvoaRevision(code, {
      ...(applicantId
        ? { applicantUpdates: [{ applicantId, documents: payloadDocs }] }
        : { orderDocuments: payloadDocs }),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setSubmitting(false);

    if (result.ok) {
      showToast(
        pick(
          lang,
          "Revisi terkirim. Tim kami akan memeriksa ulang dokumen kamu.",
          "Revision sent. Our team will re-check your documents.",
        ),
        "success",
      );
      setRefs({});
      setNote("");
      // Re-fetch the server data so badges / timeline reflect the new state.
      router.refresh();
    } else {
      showToast(result.error, "error");
    }
  };

  const busy = submitting || uploadingSlot !== null;

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <p className="text-[13px] font-semibold text-ink">
        {pick(lang, "Unggah dokumen revisi", "Upload revised documents")}
      </p>
      <p className="mt-0.5 text-[12px] leading-snug text-muted">
        {pick(
          lang,
          "File baru menggantikan dokumen lama pada slot yang sama.",
          "New files replace the old documents of the same slot.",
        )}
      </p>

      <div className="mt-3 space-y-3">
        {slots.map((slot) => {
          const def = evoaDocSlot(slot);
          const accept = (def?.accept ?? [
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
          ]).join(",");
          const maxFiles = def?.maxFiles ?? 3;
          const list = refs[slot] ?? [];
          const uploading = uploadingSlot === slot;
          return (
            <div key={slot}>
              <label className="text-[12px] font-medium text-ink">
                {slotLabel(slot, lang, fieldDefs)}
              </label>
              <input
                type="file"
                accept={accept}
                multiple={maxFiles > 1}
                disabled={busy}
                onChange={(event) => {
                  void handleFiles(slot, event.target.files);
                  // Allow re-selecting the same file after a removal.
                  event.target.value = "";
                }}
                className="mt-1 block w-full text-[12px] text-muted file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:text-[12px] file:font-semibold file:text-white hover:file:bg-brand-dark disabled:opacity-50"
              />
              {uploading ? (
                <p className="mt-1 text-[11px] text-muted">
                  {pick(lang, "Mengunggah…", "Uploading…")}
                </p>
              ) : null}
              {list.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {list.map((ref) => (
                    <li
                      key={ref.key}
                      className="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px]"
                    >
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {ref.fileName}
                      </span>
                      <span className="text-[11px] text-muted">
                        {fmtBytes(ref.sizeBytes)}
                      </span>
                      <button
                        type="button"
                        aria-label={pick(lang, "Hapus file", "Remove file")}
                        onClick={() => removeRef(slot, ref.key)}
                        className="text-muted transition-colors hover:text-danger"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder={pick(
          lang,
          "Catatan untuk tim kami (opsional)",
          "Note for our team (optional)",
        )}
        className="mt-3 w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-brand"
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => void handleSubmit()}
        className="mt-3 inline-flex h-10 items-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? pick(lang, "Mengirim…", "Sending…")
          : pick(lang, "Kirim revisi", "Send revision")}
      </button>
    </div>
  );
}
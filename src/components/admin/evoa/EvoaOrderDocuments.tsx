"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewDocument } from "@/app/actions/evoa-admin";
import type { EvoaAdminFieldDef } from "@/app/actions/evoa-admin";
import type { EvoaDocumentDTO } from "@/lib/evoa-shared";
import { showAdminToast } from "@/components/admin/toast";
import { docSlotLabel, fmtBytes } from "./EvoaOrderShared";

/**
 * The uploaded documents of one scope (the whole order, or one applicant).
 *
 * Images render inline through their stored URL; PDFs open in a new tab.
 * Ops marks each file OK or asks for a re-upload with a note — both go
 * through `reviewDocument`, which also writes the audit-trail event.
 */

const REVIEW_LABELS: Record<string, string> = {
  pending: "Menunggu",
  ok: "OK",
  revision: "Perlu revisi",
};

const REVIEW_TONES: Record<string, string> = {
  pending: "border-line bg-canvas text-muted",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  revision: "border-amber-200 bg-amber-50 text-amber-700",
};

function ReviewBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        REVIEW_TONES[status] ?? REVIEW_TONES.pending
      }`}
    >
      {REVIEW_LABELS[status] ?? status}
    </span>
  );
}

function DocumentCard({
  doc,
  defs,
}: {
  doc: EvoaDocumentDTO;
  defs: EvoaAdminFieldDef[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState("");

  const isImage = doc.mimeType.startsWith("image/");
  const isPdf = doc.mimeType === "application/pdf";

  const markOk = async () => {
    if (busy) return;
    setBusy(true);
    const result = await reviewDocument(doc.id, "ok");
    setBusy(false);
    if (result.ok) {
      showAdminToast("Dokumen ditandai OK.");
      router.refresh();
    } else {
      showAdminToast(result.error, "error");
    }
  };

  const submitRevision = async () => {
    if (busy) return;
    if (!note.trim()) {
      showAdminToast("Tulis catatan revisi dulu.", "error");
      return;
    }
    setBusy(true);
    const result = await reviewDocument(doc.id, "revision", note.trim());
    setBusy(false);
    if (result.ok) {
      showAdminToast("Revisi dokumen diminta.");
      setRevising(false);
      setNote("");
      router.refresh();
    } else {
      showAdminToast(result.error, "error");
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold text-ink">
          {docSlotLabel(doc.slot, defs)}
        </p>
        <ReviewBadge status={doc.reviewStatus} />
      </div>

      {isImage ? (
        // Plain <img> — the stored URL is (or will be) private-proxied.
        <img
          src={doc.url}
          alt={doc.fileName}
          loading="lazy"
          className="mt-2 h-36 w-full rounded-lg border border-line object-cover"
        />
      ) : (
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex h-9 items-center justify-center rounded-lg border border-line bg-canvas px-3 text-[12px] font-medium text-brand-dark transition-colors hover:bg-brand-soft"
        >
          {isPdf ? "Buka PDF ↗" : "Buka file ↗"}
        </a>
      )}

      <p className="mt-2 truncate text-[12px] text-ink" title={doc.fileName}>
        {doc.fileName}
      </p>
      <p className="text-[11px] text-muted">{fmtBytes(doc.sizeBytes)}</p>

      {doc.reviewNote ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[12px] leading-snug text-amber-700">
          {doc.reviewNote}
        </p>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || doc.reviewStatus === "ok"}
          onClick={markOk}
          className="inline-flex h-8 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Tandai OK
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRevising((value) => !value)}
          className="inline-flex h-8 items-center rounded-lg border border-line bg-white px-2.5 text-[12px] font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-40"
        >
          Minta revisi
        </button>
      </div>

      {revising ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Contoh: foto paspor buram, mohon unggah ulang…"
            className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[12px] text-ink outline-none transition-colors focus:border-brand"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={submitRevision}
              className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? "Mengirim…" : "Kirim revisi"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRevising(false);
                setNote("");
              }}
              className="inline-flex h-8 items-center rounded-lg px-2 text-[12px] font-medium text-muted transition-colors hover:text-ink"
            >
              Batal
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function EvoaOrderDocuments({
  documents,
  fieldDefs,
  title,
}: {
  documents: EvoaDocumentDTO[];
  fieldDefs: EvoaAdminFieldDef[];
  title: string;
}) {
  if (documents.length === 0) return null;

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
        {title}
      </p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {documents.map((doc) => (
          <DocumentCard key={doc.id} doc={doc} defs={fieldDefs} />
        ))}
      </div>
    </div>
  );
}
"use client";

import Link from "next/link";
import {
  EVOA_STATUS_LABELS,
  evoaDocSlot,
  type EvoaAnswers,
  type EvoaDocumentDTO,
  type EvoaFileRef,
} from "@/lib/evoa-shared";
import type { Lang } from "@/components/providers/LocaleProvider";
import type { EvoaTrackingFieldDef } from "@/app/actions/evoa-tracking";

/**
 * Small shared pieces of the customer e-VOA tracking panel: bilingual
 * formatters, status / review badges and the document & answer renderers.
 * The tone palette mirrors the admin e-VOA panel so both sides of the
 * service read the same way.
 */

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

/** Pick the copy of the active language (Indonesian is the default). */
export function pick(lang: Lang, id: string, en: string): string {
  return lang === "id" ? id : en;
}

export function fmtDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString(lang === "id" ? "id-ID" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The label of a document slot — standard slots first, then field keys. */
export function slotLabel(
  slot: string,
  lang: Lang,
  fieldDefs: EvoaTrackingFieldDef[] = [],
): string {
  const standard = evoaDocSlot(slot);
  if (standard) return lang === "id" ? standard.id : standard.en;
  const def = fieldDefs.find((field) => field.key === slot);
  if (def) return (lang === "id" ? def.labelId : null) ?? def.labelEn;
  return slot;
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const BADGE_TONES: Record<string, string> = {
  draft: "border-line bg-canvas text-muted",
  awaiting_payment: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-brand/20 bg-brand-soft text-brand-dark",
  review: "border-brand/20 bg-brand-soft text-brand-dark",
  revision: "border-amber-200 bg-amber-50 text-amber-700",
  processing: "border-brand/20 bg-brand-soft text-brand-dark",
  issued: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-danger",
  refunded: "border-line bg-canvas text-muted",
  expired: "border-line bg-canvas text-muted",
  submitted: "border-brand/20 bg-brand-soft text-brand-dark",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-line bg-canvas text-muted",
};

export function StatusBadge({ status, lang }: { status: string; lang: Lang }) {
  const tone = BADGE_TONES[status] ?? "border-line bg-canvas text-muted";
  const label = EVOA_STATUS_LABELS[status]?.[lang] ?? status;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

/** Document review state: OK / Revisi / Menunggu. */
export function ReviewBadge({
  reviewStatus,
  lang,
}: {
  reviewStatus: string;
  lang: Lang;
}) {
  if (reviewStatus === "ok") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        OK
      </span>
    );
  }
  if (reviewStatus === "revision") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        {pick(lang, "Revisi", "Revision")}
      </span>
    );
  }
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted">
      {pick(lang, "Menunggu", "Pending")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/**
 * The uploaded files of one scope (an applicant or the order), grouped by
 * slot. Files open through the authenticated `/media/<key>` proxy — never
 * through the stored url, which may point at the public bucket base.
 */
export function DocumentList({
  documents,
  lang,
  fieldDefs = [],
}: {
  documents: EvoaDocumentDTO[];
  lang: Lang;
  fieldDefs?: EvoaTrackingFieldDef[];
}) {
  if (documents.length === 0) {
    return (
      <p className="text-[12px] text-muted">
        {pick(lang, "Belum ada dokumen.", "No documents yet.")}
      </p>
    );
  }

  const slots = [...new Set(documents.map((doc) => doc.slot))];
  return (
    <div className="space-y-3">
      {slots.map((slot) => (
        <div key={slot}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
            {slotLabel(slot, lang, fieldDefs)}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {documents
              .filter((doc) => doc.slot === slot)
              .map((doc) => (
                <li
                  key={doc.id}
                  className="rounded-xl border border-line bg-canvas/50 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/media/${doc.key}`}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-[12px] font-medium text-brand transition-opacity hover:opacity-80"
                    >
                      {doc.fileName}
                    </Link>
                    <span className="text-[11px] text-muted">
                      {fmtBytes(doc.sizeBytes)}
                    </span>
                    <ReviewBadge reviewStatus={doc.reviewStatus} lang={lang} />
                  </div>
                  {doc.reviewNote ? (
                    <p className="mt-1 text-[12px] leading-snug text-amber-700">
                      {doc.reviewNote}
                    </p>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dynamic-field answers                                               */
/* ------------------------------------------------------------------ */

function isFileRefArray(value: unknown): value is EvoaFileRef[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as EvoaFileRef).key === "string" &&
        typeof (item as EvoaFileRef).url === "string",
    )
  );
}

/**
 * Render an answers map with the admin-defined field labels. Only fields
 * that actually carry an answer are shown — the tracking page is a receipt,
 * not a form.
 */
export function AnswerList({
  answers,
  defs,
  lang,
}: {
  answers: EvoaAnswers;
  defs: EvoaTrackingFieldDef[];
  lang: Lang;
}) {
  const entries = defs.filter(
    (def) => answers[def.key] !== undefined && answers[def.key] !== "",
  );
  if (entries.length === 0) return null;

  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map((def) => {
        const value = answers[def.key];
        const label = (lang === "id" ? def.labelId : null) ?? def.labelEn;
        let rendered: React.ReactNode;
        if (typeof value === "boolean") {
          rendered = value
            ? pick(lang, "Ya", "Yes")
            : pick(lang, "Tidak", "No");
        } else if (isFileRefArray(value)) {
          rendered = (
            <span className="flex flex-col gap-0.5">
              {value.map((ref) => (
                <Link
                  key={ref.key}
                  href={`/media/${ref.key}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-brand transition-opacity hover:opacity-80"
                >
                  {ref.fileName}
                </Link>
              ))}
            </span>
          );
        } else if (def.type === "date") {
          rendered = fmtDate(String(value), lang);
        } else {
          rendered = String(value);
        }
        return (
          <div key={def.key}>
            <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
              {label}
            </dt>
            <dd className="mt-0.5 text-[13px] text-ink">{rendered}</dd>
          </div>
        );
      })}
    </dl>
  );
}
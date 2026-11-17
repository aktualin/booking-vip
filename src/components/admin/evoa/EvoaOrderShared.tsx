"use client";

import { useState } from "react";
import {
  EVOA_STATUS_LABELS,
  evoaDocSlot,
  type EvoaAnswers,
  type EvoaFileRef,
} from "@/lib/evoa-shared";
import type { EvoaAdminFieldDef } from "@/app/actions/evoa-admin";

/**
 * Small shared pieces of the e-VOA admin panel: status badges, formatters,
 * copy-to-clipboard values (ops pastes these into the official portal) and
 * the dynamic-field answer renderer.
 */

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

const DATE_FMT = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const USD_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? DATE_FMT.format(date) : "—";
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? DATETIME_FMT.format(date) : "—";
}

export function fmtUsd(cents: number): string {
  return USD_FMT.format(cents / 100);
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The Indonesian label of a workflow status (shared contract). */
export function statusLabel(status: string): string {
  return EVOA_STATUS_LABELS[status]?.id ?? status;
}

/* ------------------------------------------------------------------ */
/* Status badge                                                        */
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

export function StatusBadge({ status }: { status: string }) {
  const tone = BADGE_TONES[status] ?? "border-line bg-canvas text-muted";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {statusLabel(status)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Copy-to-clipboard value                                             */
/* ------------------------------------------------------------------ */

/**
 * One labelled value with a copy button — the applicant data is laid out in
 * the official portal's field order so ops can copy-paste straight into
 * evisa.imigrasi.go.id.
 */
export function CopyValue({
  label,
  value,
  copyValue,
  mono = false,
}: {
  label: string;
  value: string;
  /** What lands on the clipboard (defaults to the displayed value). */
  copyValue?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyValue ?? value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — ignore.
    }
  };

  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
        {label}
      </p>
      <div className="mt-0.5 flex items-start gap-1.5">
        <p
          className={`min-w-0 flex-1 break-words text-[13px] text-ink ${
            mono ? "font-mono tracking-[0.02em]" : ""
          }`}
        >
          {value || "—"}
        </p>
        {value ? (
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            {copied ? "Tersalin ✓" : "Salin"}
          </button>
        ) : null}
      </div>
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
        typeof (item as EvoaFileRef).url === "string" &&
        typeof (item as EvoaFileRef).fileName === "string",
    )
  );
}

function AnswerValue({
  value,
  def,
}: {
  value: string | boolean | EvoaFileRef[];
  def?: EvoaAdminFieldDef;
}) {
  if (typeof value === "boolean") {
    return <span>{value ? "Ya" : "Tidak"}</span>;
  }
  if (isFileRefArray(value)) {
    return (
      <span className="flex flex-col gap-0.5">
        {value.map((file) => (
          <a
            key={file.key}
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="text-brand-dark underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
          >
            {file.fileName}
          </a>
        ))}
      </span>
    );
  }
  const raw = String(value);
  if (def?.type === "select") {
    const option = def.options.find((item) => item.value === raw);
    return <span>{option ? option.labelId ?? option.labelEn : raw}</span>;
  }
  if (def?.type === "date") {
    return <span>{fmtDate(raw)}</span>;
  }
  return <span>{raw}</span>;
}

/**
 * Renders the answered dynamic fields of one scope with their admin-defined
 * labels. Keys without a (still active) field definition fall back to the
 * raw key so historical answers never disappear.
 */
export function ExtraAnswersView({
  answers,
  defs,
  scope,
  title,
}: {
  answers: EvoaAnswers;
  defs: EvoaAdminFieldDef[];
  scope: "application" | "applicant";
  title: string;
}) {
  const scopeDefs = defs.filter((def) => def.scope === scope);
  const entries: { key: string; label: string; value: string | boolean | EvoaFileRef[]; def?: EvoaAdminFieldDef }[] = [];

  for (const def of scopeDefs) {
    const value = answers[def.key];
    if (value === undefined || value === null || value === "") continue;
    entries.push({ key: def.key, label: def.labelId ?? def.labelEn, value, def });
  }
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined || value === null || value === "") continue;
    if (scopeDefs.some((def) => def.key === key)) continue;
    // Unknown key — the field may have been deactivated; show it raw.
    entries.push({ key, label: key, value });
  }

  if (entries.length === 0) return null;

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
        {title}
      </p>
      <div className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {entries.map((entry) => (
          <div key={entry.key} className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
              {entry.label}
            </p>
            <p className="mt-0.5 break-words text-[13px] text-ink">
              <AnswerValue value={entry.value} def={entry.def} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The Indonesian label of a document slot (standard or dynamic field). */
export function docSlotLabel(slot: string, defs: EvoaAdminFieldDef[]): string {
  const standard = evoaDocSlot(slot);
  if (standard) return standard.id;
  const field = defs.find((def) => def.key === slot);
  if (field) return field.labelId ?? field.labelEn;
  return slot;
}
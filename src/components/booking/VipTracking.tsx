"use client";

import { useLocale } from "@/components/providers/LocaleProvider";
import type { BookingLookupDTO } from "@/types";

/**
 * The "sit back and wait" tracker of an Airport VIP booking.
 *
 * Shows the document-handling timeline (payment → documents received →
 * processing → ready → completed), the per-traveler document status, and
 * the greeter card once ops assigns one. Renders nothing for non-VIP
 * bookings, so it can be dropped into any booking view safely.
 */

const OPS_ORDER = ["waiting_documents", "processing", "ready", "in_service", "done"];

type StepState = "done" | "current" | "todo";

/** True when the booking contains the Airport VIP Service product. */
export function isVipBooking(booking: BookingLookupDTO): boolean {
  return booking.items.some((item) => item.label.startsWith("Airport VIP"));
}

const DOC_STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  received: "bg-sky-100 text-sky-800",
  processing: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  issue: "bg-red-100 text-red-800",
};

export default function VipTracking({ booking }: { booking: BookingLookupDTO }) {
  const { t } = useLocale();

  if (!isVipBooking(booking)) return null;

  const paid = booking.status === "confirmed" || booking.status === "completed";
  const cancelled = booking.status === "cancelled";
  const completed = booking.status === "completed";
  const opsIdx = Math.max(0, OPS_ORDER.indexOf(booking.opsStatus));
  const travelers = booking.travelers;
  const docsAllReceived =
    travelers.length > 0 && travelers.every((tr) => tr.docStatus !== "pending");
  const anyIssue = travelers.some((tr) => tr.docStatus === "issue");

  const steps: {
    key: "payment" | "documents" | "processing" | "ready" | "done";
    state: StepState;
  }[] = [
    { key: "payment", state: paid ? "done" : "current" },
    {
      key: "documents",
      state: docsAllReceived ? "done" : paid ? "current" : "todo",
    },
    {
      key: "processing",
      state: opsIdx >= 2 ? "done" : opsIdx === 1 ? "current" : "todo",
    },
    {
      key: "ready",
      state: opsIdx >= 4 || completed ? "done" : opsIdx >= 2 ? "current" : "todo",
    },
    {
      key: "done",
      state: opsIdx >= 4 || completed ? "done" : "todo",
    },
  ];

  const docStatusLabel = (status: string) => {
    switch (status) {
      case "received":
        return t("tracking.docStatus.received");
      case "processing":
        return t("tracking.docStatus.processing");
      case "ready":
        return t("tracking.docStatus.ready");
      case "issue":
        return t("tracking.docStatus.issue");
      default:
        return t("tracking.docStatus.pending");
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden className="text-lg">✈️</span>
        <h3 className="text-[16px] font-bold tracking-[-0.01em] text-ink">
          {t("tracking.title")}
        </h3>
      </div>
      <p className="mb-5 text-[13px] text-muted">{t("tracking.subtitle")}</p>

      {cancelled ? (
        <p className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          {t("tracking.cancelled")}
        </p>
      ) : (
        <ol className="space-y-0">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            return (
              <li key={step.key} className="relative flex gap-3.5 pb-5 last:pb-0">
                {!isLast && (
                  <span
                    aria-hidden
                    className={`absolute left-[11px] top-6 h-[calc(100%-14px)] w-px ${
                      step.state === "done" ? "bg-brand" : "bg-line"
                    }`}
                  />
                )}
                <span
                  aria-hidden
                  className={`relative z-10 mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                    step.state === "done"
                      ? "border-brand bg-brand text-white"
                      : step.state === "current"
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-line bg-white text-muted"
                  }`}
                >
                  {step.state === "done" ? "✓" : i + 1}
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-[13px] font-semibold ${
                      step.state === "todo" ? "text-muted" : "text-ink"
                    }`}
                  >
                    {t(`tracking.step.${step.key}`)}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                    {t(`tracking.step.${step.key}Desc`)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Per-traveler document status */}
      {travelers.length > 0 && !cancelled && (
        <div className="mt-5 border-t border-line pt-5">
          <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
            {t("tracking.docsTitle")}
          </p>
          <ul className="space-y-2">
            {travelers.map((tr, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas/60 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {tr.fullName}
                  </p>
                  <p className="text-[11px] text-muted">
                    {tr.passportPhotoKey
                      ? t("tracking.photoUploaded")
                      : t("tracking.photoMissing")}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    DOC_STATUS_STYLE[tr.docStatus] ?? DOC_STATUS_STYLE.pending
                  }`}
                >
                  {docStatusLabel(tr.docStatus)}
                </span>
              </li>
            ))}
          </ul>
          {anyIssue && (
            <p className="mt-3 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[12px] text-danger">
              {t("tracking.issueNote")}
            </p>
          )}
        </div>
      )}

      {/* Greeter card */}
      {booking.greeterName && !cancelled && (
        <div className="mt-5 rounded-xl border border-brand/20 bg-brand-soft/50 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-brand">
            {t("tracking.greeterTitle")}
          </p>
          <p className="mt-1 text-[14px] font-bold text-ink">
            {booking.greeterName}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            {t("tracking.greeterDesc")}
          </p>
          {booking.greeterPhone && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`tel:${booking.greeterPhone.replace(/[^\d+]/g, "")}`}
                className="inline-flex h-9 items-center rounded-lg bg-brand px-3.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                {t("tracking.call")}
              </a>
              <a
                href={`https://wa.me/${booking.greeterPhone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center rounded-lg border border-brand/30 bg-white px-3.5 text-[12px] font-semibold text-brand transition-colors hover:bg-brand-soft"
              >
                {t("tracking.whatsapp")}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

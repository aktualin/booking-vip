"use client";

import { EVOA_STATUS_LABELS, type EvoaStatusEventDTO } from "@/lib/evoa-shared";
import { useLocale } from "@/components/providers/LocaleProvider";
import { fmtDateTime, pick } from "./shared";

/**
 * The order's audit trail as a vertical timeline — newest event first.
 * Applicant-scoped events carry the person's name so a group order reads
 * unambiguously.
 */

const DOT_TONES: Record<string, string> = {
  revision: "bg-amber-500",
  awaiting_payment: "bg-amber-500",
  issued: "bg-emerald-500",
  completed: "bg-emerald-500",
  approved: "bg-emerald-500",
  rejected: "bg-danger",
};

export default function EvoaTimeline({
  events,
  applicantNames,
}: {
  events: EvoaStatusEventDTO[];
  /** applicantId → fullName, for labelling person-scoped events. */
  applicantNames: Record<string, string>;
}) {
  const { lang } = useLocale();

  if (events.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        {pick(lang, "Belum ada aktivitas.", "No activity yet.")}
      </p>
    );
  }

  const actorLabel = (actor: string) => {
    if (actor === "customer") return pick(lang, "Kamu", "You");
    if (actor === "admin") return pick(lang, "Tim Booking VIP", "Booking VIP team");
    return pick(lang, "Sistem", "System");
  };

  return (
    <ol className="relative ml-1 border-l border-line pl-5">
      {events.map((event) => {
        const dot = DOT_TONES[event.status] ?? "bg-brand";
        const label = EVOA_STATUS_LABELS[event.status]?.[lang] ?? event.status;
        const person = event.applicantId
          ? applicantNames[event.applicantId]
          : undefined;
        return (
          <li key={event.id} className="relative pb-5 last:pb-0">
            {/* The dot sits centred on the vertical line (pl-5 = 20px). */}
            <span
              className={`absolute -left-[25.5px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${dot}`}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <p className="text-[13px] font-semibold text-ink">{label}</p>
              {person ? (
                <span className="text-[12px] text-muted">· {person}</span>
              ) : null}
              <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted">
                {actorLabel(event.actor)}
              </span>
            </div>
            {event.note ? (
              <p className="mt-0.5 text-[12px] leading-snug text-muted">
                {event.note}
              </p>
            ) : null}
            <p className="mt-0.5 text-[11px] text-muted">
              {fmtDateTime(event.createdAt, lang)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
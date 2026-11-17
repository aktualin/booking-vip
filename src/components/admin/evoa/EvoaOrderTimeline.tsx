"use client";

import type { EvoaAdminEventDTO } from "@/app/actions/evoa-admin";
import { StatusBadge, fmtDateTime } from "./EvoaOrderShared";

/**
 * The audit trail of one order — newest first (the server action already
 * sorts). Every admin mutation appends a row here, so the timeline doubles
 * as the ops log.
 */

function actorLabel(event: EvoaAdminEventDTO): string {
  if (event.actor === "admin") {
    return event.actorEmail ? `Admin · ${event.actorEmail}` : "Admin";
  }
  if (event.actor === "customer") return "Pelanggan";
  return "Sistem";
}

export default function EvoaOrderTimeline({
  events,
  applicants,
}: {
  events: EvoaAdminEventDTO[];
  /** Used to name the applicant an event belongs to. */
  applicants: { id: string; fullName: string }[];
}) {
  const nameById = new Map(applicants.map((person) => [person.id, person.fullName]));

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
        Riwayat status
      </h2>

      {events.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Belum ada riwayat.</p>
      ) : (
        <ol className="mt-3 divide-y divide-line/70">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={event.status} />
                {event.applicantId ? (
                  <span className="text-[12px] font-medium text-ink">
                    {nameById.get(event.applicantId) ?? "Pemohon"}
                  </span>
                ) : null}
                <span className="text-[11px] text-muted">
                  {fmtDateTime(event.createdAt)}
                </span>
              </div>
              {event.note ? (
                <p className="text-[13px] leading-snug text-ink">{event.note}</p>
              ) : null}
              <p className="text-[11px] text-muted">{actorLabel(event)}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
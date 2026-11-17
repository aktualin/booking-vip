"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/providers/LocaleProvider";
import { getTourDepartureCalendar } from "@/app/actions/catalog";
import type { TourDepartureDTO } from "@/types/tour";

/**
 * Departure availability calendar for join-in tour products.
 *
 * Shows a monthly grid with seat availability per day. Clicking an available
 * day navigates to the booking wizard with the date pre-selected. Private
 * tours show a simple flexible-dates note instead.
 */

type Props = {
  productId: string;
  tourKind: string | null;
  /** Product slug — used to build the booking link. */
  productSlug: string;
  /** Currently selected package id — passed through to the booking link. */
  packageId: string;
  initialMonth?: string;
};

/** Format a Date as "YYYY-MM". */
function toYearMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Parse "YYYY-MM" into a Date (first of month). */
function parseYearMonth(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

/** Format a Date as "YYYY-MM-DD" for URL params. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Month names in Indonesian and English. */
const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Day-of-week headers (Mon-Sun). */
const DAY_HEADERS_ID = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const DAY_HEADERS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function TourDepartureCalendar({
  productId,
  tourKind,
  productSlug,
  packageId,
  initialMonth,
}: Props) {
  const { t, lang } = useLocale();

  // Current displayed month
  const [currentMonth, setCurrentMonth] = useState<string>(
    initialMonth ?? toYearMonth(new Date()),
  );
  const [departures, setDepartures] = useState<TourDepartureDTO[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch departures when month changes
  const fetchMonth = useCallback(
    async (ym: string) => {
      setLoading(true);
      try {
        const result = await getTourDepartureCalendar(productId, ym);
        setDepartures(result.departures);
      } catch {
        setDepartures([]);
      } finally {
        setLoading(false);
      }
    },
    [productId],
  );

  useEffect(() => {
    fetchMonth(currentMonth);
  }, [currentMonth, fetchMonth]);

  // Navigate months
  const goToPrevMonth = () => {
    const d = parseYearMonth(currentMonth);
    d.setMonth(d.getMonth() - 1);
    setCurrentMonth(toYearMonth(d));
  };

  const goToNextMonth = () => {
    const d = parseYearMonth(currentMonth);
    d.setMonth(d.getMonth() + 1);
    setCurrentMonth(toYearMonth(d));
  };

  // Build a map of date string → departure(s) for quick lookup
  const departureMap = useMemo(() => {
    const map = new Map<string, TourDepartureDTO[]>();
    for (const dep of departures) {
      // Extract just the date part from ISO string
      const dateKey = dep.date.slice(0, 10);
      const existing = map.get(dateKey) ?? [];
      existing.push(dep);
      map.set(dateKey, existing);
    }
    return map;
  }, [departures]);

  // Calendar grid computation
  const monthDate = parseYearMonth(currentMonth);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat
  // We want Mon=0, so adjust: (getDay() + 6) % 7
  const startDow = (firstDayOfMonth.getDay() + 6) % 7;

  const monthNames = lang === "id" ? MONTH_NAMES_ID : MONTH_NAMES_EN;
  const dayHeaders = lang === "id" ? DAY_HEADERS_ID : DAY_HEADERS_EN;

  // Private tour — show flexible dates note
  if (tourKind === "private") {
    return (
      <div className="mb-6 rounded-xl border border-line bg-white p-5">
        <h2 className="mb-2 text-lg font-extrabold text-ink">
          {t("tour.calendar.title")}
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          🗓️ {t("tour.calendar.privateNote")}
        </p>
      </div>
    );
  }

  // Only show for join-in tours
  if (tourKind !== "join_in") {
    return null;
  }

  /** Determine the visual state of a day cell. */
  function getDayState(dateKey: string) {
    const deps = departureMap.get(dateKey);
    if (!deps || deps.length === 0) return null;

    // If any departure is open with seats, show the best availability
    const openDeps = deps.filter((d) => d.status === "open");
    if (openDeps.length === 0) {
      // All closed/cancelled
      return { status: "closed" as const, available: 0, label: t("tour.calendar.closed") };
    }

    // Sum available seats across all open departures for this day
    const totalAvailable = openDeps.reduce((sum, d) => sum + d.available, 0);
    if (totalAvailable === 0) {
      return { status: "soldOut" as const, available: 0, label: t("tour.calendar.soldOut") };
    }
    if (totalAvailable <= 5) {
      return { status: "almostFull" as const, available: totalAvailable, label: t("tour.calendar.seatsRemaining", { n: totalAvailable }) };
    }
    return { status: "available" as const, available: totalAvailable, label: t("tour.calendar.seatsRemaining", { n: totalAvailable }) };
  }

  /** Build the booking link for a specific date. */
  function buildBookingLink(dateKey: string) {
    const query = new URLSearchParams();
    query.set("package", `${productSlug}::${packageId}`);
    query.set("date", dateKey);
    query.set("adults", "2");
    query.set("children", "0");
    query.set("infants", "0");
    return `/tour-package/search?${query.toString()}`;
  }

  // Render the grid cells
  const cells: React.ReactNode[] = [];

  // Empty cells before the first day
  for (let i = 0; i < startDow; i++) {
    cells.push(<div key={`empty-${i}`} className="min-h-[44px]" />);
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const state = getDayState(dateKey);
    const isClickable = state != null && (state.status === "available" || state.status === "almostFull");

    let dotColor = "";
    let badgeClass = "";
    if (state) {
      if (state.status === "available") {
        dotColor = "bg-emerald-500";
        badgeClass = "text-emerald-700 bg-emerald-50";
      } else if (state.status === "almostFull") {
        dotColor = "bg-amber-500";
        badgeClass = "text-amber-700 bg-amber-50";
      } else {
        dotColor = "bg-gray-300";
        badgeClass = "text-gray-400 bg-gray-50";
      }
    }

    const cellContent = (
      <div
        className={`flex min-h-[44px] flex-col items-center justify-center rounded-lg border p-1 transition-colors ${
          isClickable
            ? "cursor-pointer border-line bg-white hover:border-brand hover:bg-brand-soft"
            : "border-transparent bg-transparent"
        } ${state == null ? "opacity-40" : ""}`}
      >
        <span className={`text-[13px] font-semibold ${state?.status === "soldOut" || state?.status === "closed" ? "text-muted line-through" : "text-ink"}`}>
          {day}
        </span>
        {state && (
          <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${badgeClass}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
            {state.label}
          </span>
        )}
      </div>
    );

    if (isClickable) {
      cells.push(
        <Link key={day} href={buildBookingLink(dateKey)} className="contents">
          {cellContent}
        </Link>,
      );
    } else {
      cells.push(<div key={day}>{cellContent}</div>);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-line bg-white p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-ink">
          {t("tour.calendar.title")}
        </h2>
      </div>

      {/* Month navigation */}
      <div className="mb-3 flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2">
        <button
          type="button"
          onClick={goToPrevMonth}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-white hover:text-ink disabled:opacity-50"
          aria-label={t("tour.calendar.monthPrev")}
        >
          ←
        </button>
        <span className="text-[14px] font-bold text-ink">
          {monthNames[month]} {year}
        </span>
        <button
          type="button"
          onClick={goToNextMonth}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-white hover:text-ink disabled:opacity-50"
          aria-label={t("tour.calendar.monthNext")}
        >
          →
        </button>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="mb-3 text-center text-[12px] text-muted">
          {t("tour.calendar.loading")}
        </div>
      )}

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {dayHeaders.map((dh) => (
          <div key={dh} className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
            {dh}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          {t("tour.calendar.legendAvailable")}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          {t("tour.calendar.legendAlmostFull")}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
          {t("tour.calendar.legendSoldOut")}
        </span>
      </div>

      {/* No departures message */}
      {!loading && departures.length === 0 && (
        <p className="mt-3 text-center text-[12px] text-muted">
          {t("tour.calendar.noDepartures")}
        </p>
      )}
    </div>
  );
}

import "server-only";

import { db } from "@/prisma/db";
import { param } from "@prisma/orm-postgres/relational-core/expression";
import { STOCK_RESERVATION_TTL_MS } from "@/lib/stock";
import type {
  TourDepartureDTO,
  TourDriverDTO,
  TourKind,
  TourProductRules,
  TourVehicleDTO,
} from "@/types/tour";

/**
 * Tour operations data layer — shared by the customer flow, the booking
 * action and the admin area.
 *
 * Join-in seat availability follows the transport rental stock pattern
 * (`src/lib/stock.ts`): seats are derived, never stored.
 *   - every "confirmed" booking reserves its adult + child count, always;
 *   - an "awaiting_payment" booking reserves for 24 hours after creation,
 *     then lazily expires (no cron);
 *   - "completed" and "cancelled" bookings reserve nothing.
 * Infants do not occupy a seat.
 */

/** How long an unpaid booking keeps its departure seats reserved. */
export const TOUR_SEAT_RESERVATION_TTL_MS = STOCK_RESERVATION_TTL_MS;

/** Seats reserved per departure — one aggregate over the active bookings. */
export async function getDepartureReservedSeats(
  departureIds: string[],
): Promise<Map<string, number>> {
  const reserved = new Map<string, number>();
  const ids = [...new Set(departureIds)];
  if (ids.length === 0) return reserved;

  const cutoff = new Date(Date.now() - TOUR_SEAT_RESERVATION_TTL_MS);

  const rows = await db.query(
    db.raw.sql`
      SELECT b."departureId" AS "departureId",
             SUM(b."adultCount" + b."childCount")::int4 AS "reserved"
      FROM "Booking" b
      WHERE b."departureId" = ANY(${param(ids, { codecId: "pg/text@1" })}::text[])
        AND (
          b."status" = 'confirmed'
          OR (
            b."status" = 'awaiting_payment'
            AND b."createdAt" >= ${param(cutoff, { codecId: "pg/timestamp-date@1" })}
          )
        )
      GROUP BY b."departureId"
    `
      .returnsRow({ departureId: "pg/text@1", reserved: "pg/int4@1" })
      .build(),
  );

  for (const row of rows) {
    reserved.set(row.departureId, row.reserved);
  }
  return reserved;
}

/** Build the availability DTO from a departure row + the reserved seats. */
function toDepartureDTO(
  row: {
    id: string;
    productId: string;
    date: Date;
    startTime: string;
    quota: number;
    status: string;
    notes: string | null;
  },
  reserved: Map<string, number>,
): TourDepartureDTO {
  const used = reserved.get(row.id) ?? 0;
  return {
    id: row.id,
    productId: row.productId,
    date: new Date(row.date).toISOString(),
    startTime: row.startTime,
    quota: row.quota,
    reserved: used,
    available: Math.max(0, row.quota - used),
    status: row.status,
    notes: row.notes,
  };
}

/**
 * The departures of a tour product with seat availability.
 *
 * By default only future "open" departures are returned (the customer
 * view); `includeClosed` also returns closed / cancelled ones (admin view).
 */
export async function listTourDepartures(
  productId: string,
  opts?: { fromDate?: Date; includeClosed?: boolean },
): Promise<TourDepartureDTO[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = opts?.fromDate ?? today;

  let query = db.orm.public.TourDeparture
    .select("id", "productId", "date", "startTime", "quota", "status", "notes")
    .where((f) => f.productId.eq(productId))
    .where((f) => f.date.gte(from));
  if (!opts?.includeClosed) {
    query = query.where((f) => f.status.eq("open"));
  }
  const rows = await query
    .orderBy((f) => f.date.asc())
    .orderBy((f) => f.startTime.asc())
    .all();

  const reserved = await getDepartureReservedSeats(rows.map((r) => r.id));
  return rows.map((r) => toDepartureDTO(r, reserved));
}

/** One departure with availability — null when it does not exist. */
export async function getTourDeparture(
  departureId: string,
): Promise<TourDepartureDTO | null> {
  const rows = await db.orm.public.TourDeparture
    .select("id", "productId", "date", "startTime", "quota", "status", "notes")
    .where((f) => f.id.eq(departureId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) return null;
  const reserved = await getDepartureReservedSeats([row.id]);
  return toDepartureDTO(row, reserved);
}

/**
 * Guard for booking creation: the departure must exist, be open, be in the
 * future and have enough seats left. Indonesian customer-facing errors.
 */
export async function assertDepartureSeats(
  departureId: string,
  seats: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const departure = await getTourDeparture(departureId);
  if (!departure) {
    return { ok: false, error: "Jadwal keberangkatan tidak ditemukan." };
  }
  if (departure.status !== "open") {
    return { ok: false, error: "Jadwal keberangkatan ini sudah ditutup." };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(departure.date) < today) {
    return { ok: false, error: "Jadwal keberangkatan sudah lewat." };
  }
  if (seats > departure.available) {
    return {
      ok: false,
      error: `Kuota tidak cukup. Tersisa ${departure.available} kursi untuk jadwal ini.`,
    };
  }
  return { ok: true };
}

/** The active drivers of the roster, in display order. */
export async function listActiveDrivers(): Promise<TourDriverDTO[]> {
  const rows = await db.orm.public.Driver
    .select("id", "name", "phone", "languages", "photoUrl", "notes", "active", "sortOrder")
    .where((f) => f.active.eq(true))
    .orderBy((f) => f.sortOrder.asc())
    .orderBy((f) => f.name.asc())
    .all();
  return rows.map((r) => ({ ...r }));
}

/** The active vehicles of the roster, in display order. */
export async function listActiveVehicles(): Promise<TourVehicleDTO[]> {
  const rows = await db.orm.public.Vehicle
    .select("id", "name", "plateNumber", "seats", "photoUrl", "notes", "active", "sortOrder")
    .where((f) => f.active.eq(true))
    .orderBy((f) => f.sortOrder.asc())
    .orderBy((f) => f.name.asc())
    .all();
  return rows.map((r) => ({ ...r }));
}

/**
 * The tour rules of a product — used by `createBooking` to validate the
 * party size. `tourKind` is null for non-tour products.
 */
export async function getTourProductRules(
  productId: string,
): Promise<TourProductRules | null> {
  const rows = await db.orm.public.Product
    .select("id", "tourKind", "minPax", "maxPax", "durationDays", "leadTimeDays", "leadTimeHours")
    .where((f) => f.id.eq(productId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) return null;
  const tourKind: TourKind | null =
    row.tourKind === "private" || row.tourKind === "join_in" ? row.tourKind : null;
  return {
    productId: row.id,
    tourKind,
    minPax: row.minPax ?? 1,
    maxPax: row.maxPax ?? null,
    durationDays: row.durationDays ?? 0,
    leadTimeDays: row.leadTimeDays ?? 0,
    leadTimeHours: row.leadTimeHours ?? 0,
  };
}

export type AssignmentConflict = {
  id: string;
  code: string;
  status: string;
  serviceAt: string;
  driverId: string | null;
  vehicleId: string | null;
};

/**
 * Bookings that would clash with a driver / vehicle assignment on the same
 * calendar day. Only active bookings count (confirmed always; unpaid within
 * the reservation TTL). The booking being edited is excluded.
 */
export async function findAssignmentConflicts(input: {
  driverId?: string | null;
  vehicleId?: string | null;
  serviceAt: Date;
  excludeBookingId?: string;
}): Promise<AssignmentConflict[]> {
  const { driverId, vehicleId, serviceAt, excludeBookingId } = input;
  if (!driverId && !vehicleId) return [];

  const dayStart = new Date(serviceAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const cutoff = new Date(Date.now() - TOUR_SEAT_RESERVATION_TTL_MS);

  const rows = await db.orm.public.Booking
    .select("id", "code", "status", "serviceAt", "driverId", "vehicleId", "createdAt")
    .where((f) => f.serviceAt.gte(dayStart))
    .where((f) => f.serviceAt.lt(dayEnd))
    .where((f) => f.status.in(["confirmed", "awaiting_payment"]))
    .all();

  const conflicts: AssignmentConflict[] = [];
  for (const row of rows) {
    if (excludeBookingId && row.id === excludeBookingId) continue;
    const unpaidExpired =
      row.status === "awaiting_payment" && new Date(row.createdAt) < cutoff;
    if (unpaidExpired) continue;
    const driverClash = !!driverId && row.driverId === driverId;
    const vehicleClash = !!vehicleId && row.vehicleId === vehicleId;
    if (driverClash || vehicleClash) {
      conflicts.push({
        id: row.id,
        code: row.code,
        status: row.status,
        serviceAt: new Date(row.serviceAt).toISOString(),
        driverId: row.driverId,
        vehicleId: row.vehicleId,
      });
    }
  }
  return conflicts;
}

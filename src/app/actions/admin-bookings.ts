"use server";

import { db } from "@/prisma/db";
import { and, or, all, type Condition, type ModelAccessor } from "@prisma/orm-postgres/orm-client";
import type { Contract } from "@/prisma/contract.d";
import { assertAdmin } from "./admin";
import {
  findAssignmentConflicts,
  getTourDeparture,
  listActiveDrivers,
  listActiveVehicles,
  listTourDepartures,
} from "@/lib/tour";
import { computeRefund, getCancellationPolicy } from "@/lib/cancellation";
import type {
  AdminBookingDetail,
  AdminBookingListResult,
  AdminBookingRow,
  AdminBookingStatus,
  AdminTransactionStats,
} from "@/types/admin";
import type {
  AdminBookingDetailFull,
  AdminBookingRowFull,
  AssignmentOptions,
} from "@/types/admin-bookings";
import type { TourDepartureDTO } from "@/types/tour";

/**
 * Admin transaction management — bookings per service line.
 *
 * Every action is gated by the shared `assertAdmin()` from `./admin`
 * (ADMIN_ENABLED kill-switch + verified admin session cookie + User.role
 * ADMIN). Status transitions are guarded server-side; the UI only mirrors
 * the rules:
 *
 *   - completed  ← confirmed only (the service was handed over);
 *   - cancelled  ← awaiting_payment or confirmed;
 *   - completed / cancelled are terminal — no way back.
 *
 * Stock needs no explicit release on a transition: availability is derived
 * from the active bookings (see src/lib/stock.ts), so completing or
 * cancelling a booking returns its units automatically.
 */

const BOOKING_STATUSES: readonly AdminBookingStatus[] = [
  "awaiting_payment",
  "confirmed",
  "cancelled",
  "completed",
];

function isBookingStatus(value: unknown): value is AdminBookingStatus {
  return (
    typeof value === "string" &&
    (BOOKING_STATUSES as readonly string[]).includes(value)
  );
}

/** Escape the LIKE wildcards so a search term matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Line scope resolution
// ---------------------------------------------------------------------------

/**
 * The product ids that define a line scope.
 *
 * A booking belongs to a line when ANY of its items points at one of these
 * products (BookingItem.productId → Product.lineId).
 *
 * "fast-track" is the one special scope: it is not a ServiceLine but the
 * fast-track ServiceType under the vip-service line, so its products are
 * the vip-service products carrying that type.
 */
async function lineProductIds(lineSlug: string): Promise<string[]> {
  // "airport-vip" is an alias some admin surfaces use for the real line
  // slug "vip-service" (Airport VIP Service).
  const slug = lineSlug === "airport-vip" ? "vip-service" : lineSlug;

  if (slug === "fast-track") {
    const line = await db.orm.public.ServiceLine
      .select("id")
      .where({ slug: "vip-service" })
      .first();
    if (!line) return [];
    const type = await db.orm.public.ServiceType
      .select("id")
      .where({ lineId: line.id, slug: "fast-track" })
      .first();
    if (!type) return [];
    const products = await db.orm.public.Product
      .select("id")
      .where({ lineId: line.id, serviceTypeId: type.id })
      .all();
    return products.map((p) => p.id);
  }

  const line = await db.orm.public.ServiceLine
    .select("id")
    .where({ slug })
    .first();
  if (!line) throw new Error("Service line tidak ditemukan.");
  const products = await db.orm.public.Product
    .select("id")
    .where({ lineId: line.id })
    .all();
  return products.map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Shared filter
// ---------------------------------------------------------------------------

type BookingAccessor = ModelAccessor<Contract, "Booking", "public">;

type BookingScope = {
  /** null = no line filter; [] = a line with no products (matches nothing). */
  productIds: string[] | null;
  status: AdminBookingStatus | null;
  /** Raw search term — matches the booking code or the contact email. */
  query: string | null;
};

/**
 * One predicate for the list, the count and the stats, so the three can
 * never disagree about what "a booking of this line" means.
 */
function bookingPredicate(scope: BookingScope) {
  return (b: BookingAccessor): Condition => {
    const parts: Condition[] = [];
    if (scope.productIds) {
      const ids = scope.productIds;
      parts.push(b.items.some((i) => i.productId.in(ids)));
    }
    if (scope.status) parts.push(b.status.eq(scope.status));
    if (scope.query) {
      const pattern = `%${escapeLike(scope.query)}%`;
      parts.push(
        or(b.code.ilike(pattern), b.contact.some((c) => c.email.ilike(pattern))),
      );
    }
    return and(all(), ...parts);
  };
}

/** ISO string or null — the DTOs carry dates as strings. */
function iso(value: Date | string | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// listAdminBookings
// ---------------------------------------------------------------------------

/**
 * The transaction table of one line: newest first, offset pagination.
 *
 * `query` matches the booking code or the contact email, case-insensitive.
 * A booking appears under a line when ANY item belongs to it.
 */
export async function listAdminBookings(input: {
  lineSlug?: string;
  status?: AdminBookingStatus;
  query?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: AdminBookingRowFull[]; total: number; page: number; pageSize: number }> {
  await assertAdmin();

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("page must be an integer >= 1");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (input.status != null && !isBookingStatus(input.status)) {
    throw new Error("Status booking tidak valid.");
  }

  const productIds = input.lineSlug ? await lineProductIds(input.lineSlug) : null;
  const query = input.query?.trim() ? input.query.trim() : null;
  const scope: BookingScope = {
    productIds,
    status: input.status ?? null,
    query,
  };

  // A line with no products can never have bookings — skip the queries.
  if (productIds && productIds.length === 0) {
    return { rows: [], total: 0, page, pageSize };
  }

  const where = bookingPredicate(scope);

  const [rows, count] = await Promise.all([
    db.orm.public.Booking
      .select(
        "id",
        "code",
        "status",
        "serviceAt",
        "createdAt",
        "totalUsdCents",
        "vehicleCount",
        "adultCount",
        "childCount",
        "infantCount",
      )
      .where(where)
      .include("contact", (c) => c.select("firstName", "lastName", "email"))
      .include("items", (i) =>
        i
          .select(
            "label",
            "packageLabel",
            "unitKind",
            "quantity",
            "productId",
            "unitUsdCents",
            "totalUsdCents",
          )
          .include("product", (p) => p.select("title", "lineId", "tourKind")),
      )
      .include("payments", (p) =>
        p.select("status").orderBy((x) => x.createdAt.desc()).limit(1),
      )
      .include("driver", (d) => d.select("name"))
      .orderBy([(b) => b.createdAt.desc(), (b) => b.id.desc()])
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all(),
    db.orm.public.Booking.where(where).aggregate((a) => ({ n: a.count() })),
  ]);

  // Resolve the line labels in one batched query (first item's product line).
  const lineIds = [
    ...new Set(
      rows.flatMap((r) => r.items[0]?.product?.lineId ?? []),
    ),
  ];
  const lineRows = lineIds.length
    ? await db.orm.public.ServiceLine
        .select("id", "slug", "label")
        .where((f) => f.id.in(lineIds))
        .all()
    : [];
  const lineMap = new Map(lineRows.map((l) => [l.id, l]));

  return {
    rows: rows.map((r): AdminBookingRowFull => {
      const customerName = r.contact
        ? `${r.contact.firstName} ${r.contact.lastName}`.trim() || null
        : null;
      const line = r.items[0]?.product?.lineId
        ? lineMap.get(r.items[0].product.lineId)
        : undefined;
      return {
        id: r.id,
        code: r.code,
        status: r.status as AdminBookingStatus,
        serviceAt: iso(r.serviceAt)!,
        createdAt: iso(r.createdAt)!,
        totalUsdCents: r.totalUsdCents,
        vehicleCount: r.vehicleCount,
        customerName,
        customerEmail: r.contact?.email ?? null,
        items: r.items.map((item) => ({
          label: item.label,
          packageLabel: item.packageLabel,
          unitKind: item.unitKind,
          quantity: item.quantity,
          productId: item.productId,
          productTitle: item.product?.title ?? null,
          unitUsdCents: item.unitUsdCents,
          totalUsdCents: item.totalUsdCents,
        })),
        paymentStatus: r.payments[0]?.status ?? null,
        lineSlug: line?.slug ?? null,
        lineLabel: line?.label ?? null,
        adultCount: r.adultCount,
        childCount: r.childCount,
        infantCount: r.infantCount,
        driverName: r.driver?.name ?? null,
      };
    }),
    total: count.n,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// getAdminBooking
// ---------------------------------------------------------------------------

/** The full detail of one booking — the transaction drawer. */
export async function getAdminBooking(id: string): Promise<AdminBookingDetailFull | null> {
  await assertAdmin();
  if (typeof id !== "string" || id.trim().length === 0) return null;

  const r = await db.orm.public.Booking
    .select(
      "id",
      "code",
      "status",
      "serviceAt",
      "createdAt",
      "totalUsdCents",
      "vehicleCount",
      "invoiceNumber",
      "adultCount",
      "childCount",
      "infantCount",
      "subtotalUsdCents",
      "addOnsUsdCents",
      "discountUsdCents",
      "taxUsdCents",
      "promoCode",
      "pickupLabel",
      "dropoffLabel",
      "pickupLat",
      "pickupLng",
      "dropoffLat",
      "dropoffLng",
      "driverOption",
      "pickupPolicy",
      "notes",
      "hotelName",
      "departureId",
      "driverId",
      "vehicleId",
    )
    .where({ id })
    .include("contact", (c) =>
      c.select(
        "title",
        "firstName",
        "lastName",
        "email",
        "phoneCountryCode",
        "phone",
        "nationality",
        "idType",
        "identityNumber",
      ),
    )
    .include("items", (i) =>
      i
        .select(
          "label",
          "packageLabel",
          "unitKind",
          "quantity",
          "productId",
          "unitUsdCents",
          "totalUsdCents",
        )
        .include("product", (p) => p.select("title", "lineId", "tourKind")),
    )
    .include("addOns", (a) => a.select("label", "quantity", "totalUsdCents"))
    .include("payments", (p) =>
      p
        .select("status", "amountUsdCents", "provider", "reference", "paidAt", "createdAt")
        .include("method", (m) => m.select("label"))
        .orderBy((x) => x.createdAt.desc())
        .limit(1),
    )
    .include("flight", (f) =>
      f.select("airline", "flightCode", "direction", "airportName", "location"),
    )
    .include("driver", (d) =>
      d.select("id", "name", "phone", "languages", "photoUrl", "notes", "active", "sortOrder"),
    )
    .include("vehicle", (v) =>
      v.select("id", "name", "plateNumber", "seats", "photoUrl", "notes", "active", "sortOrder"),
    )
    .first();

  if (!r) return null;

  const payment = r.payments[0];
  const customerName = r.contact
    ? `${r.contact.firstName} ${r.contact.lastName}`.trim() || null
    : null;

  // The line of the first booked product + the tour kind.
  const firstProduct = r.items[0]?.product;
  const line = firstProduct?.lineId
    ? await db.orm.public.ServiceLine
        .select("slug", "label")
        .where({ id: firstProduct.lineId })
        .first()
    : null;

  // The departure with live seat availability (derived, never stored).
  const departure: TourDepartureDTO | null = r.departureId
    ? await getTourDeparture(r.departureId)
    : null;

  return {
    id: r.id,
    code: r.code,
    status: r.status as AdminBookingStatus,
    serviceAt: iso(r.serviceAt)!,
    createdAt: iso(r.createdAt)!,
    totalUsdCents: r.totalUsdCents,
    vehicleCount: r.vehicleCount,
    customerName,
    customerEmail: r.contact?.email ?? null,
    items: r.items.map((item) => ({
      label: item.label,
      packageLabel: item.packageLabel,
      unitKind: item.unitKind,
      quantity: item.quantity,
      productId: item.productId,
      productTitle: item.product?.title ?? null,
      unitUsdCents: item.unitUsdCents,
      totalUsdCents: item.totalUsdCents,
    })),
    paymentStatus: payment?.status ?? null,
    invoiceNumber: r.invoiceNumber,
    adultCount: r.adultCount,
    childCount: r.childCount,
    infantCount: r.infantCount,
    subtotalUsdCents: r.subtotalUsdCents,
    addOnsUsdCents: r.addOnsUsdCents,
    discountUsdCents: r.discountUsdCents,
    taxUsdCents: r.taxUsdCents,
    promoCode: r.promoCode,
    pickupLabel: r.pickupLabel,
    dropoffLabel: r.dropoffLabel,
    driverOption: r.driverOption,
    pickupPolicy: r.pickupPolicy,
    notes: r.notes,
    contact: r.contact
      ? {
          title: r.contact.title,
          firstName: r.contact.firstName,
          lastName: r.contact.lastName,
          email: r.contact.email,
          phoneCountryCode: r.contact.phoneCountryCode,
          phone: r.contact.phone,
          nationality: r.contact.nationality,
          idType: r.contact.idType,
          identityNumber: r.contact.identityNumber,
        }
      : null,
    addOns: r.addOns.map((a) => ({
      label: a.label,
      quantity: a.quantity,
      totalUsdCents: a.totalUsdCents,
    })),
    payment: payment
      ? {
          status: payment.status,
          amountUsdCents: payment.amountUsdCents,
          provider: payment.provider,
          reference: payment.reference,
          methodLabel: payment.method?.label ?? null,
          paidAt: iso(payment.paidAt),
          createdAt: iso(payment.createdAt)!,
        }
      : null,
    flight: r.flight
      ? {
          airline: r.flight.airline,
          flightCode: r.flight.flightCode,
          direction: r.flight.direction,
          airportName: r.flight.airportName,
          location: r.flight.location,
        }
      : null,
    lineSlug: line?.slug ?? null,
    lineLabel: line?.label ?? null,
    hotelName: r.hotelName,
    pickupLat: r.pickupLat,
    pickupLng: r.pickupLng,
    dropoffLat: r.dropoffLat,
    dropoffLng: r.dropoffLng,
    tourKind: firstProduct?.tourKind ?? null,
    departure,
    driver: r.driver ? { ...r.driver } : null,
    vehicle: r.vehicle ? { ...r.vehicle } : null,
  };
}

// ---------------------------------------------------------------------------
// setBookingStatus
// ---------------------------------------------------------------------------

/**
 * The handover / cancel transition.
 *
 * Guarded rules (terminal states reject with an Indonesian error):
 *   - "completed" only from "confirmed";
 *   - "cancelled" only from "awaiting_payment" or "confirmed".
 *
 * Stock returns to availability automatically — completed and cancelled
 * bookings reserve nothing (src/lib/stock.ts), so no stock write happens
 * here.
 */
export async function setBookingStatus(
  id: string,
  next: "completed" | "cancelled",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin();
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "admin unauthorized",
    };
  }

  if (typeof id !== "string" || id.trim().length === 0) {
    return { ok: false, error: "Booking tidak ditemukan." };
  }
  if (next !== "completed" && next !== "cancelled") {
    return { ok: false, error: "Status tujuan tidak valid." };
  }

  const booking = await db.orm.public.Booking
    .select("id", "status", "serviceAt", "totalUsdCents", "notes")
    .where({ id })
    .first();
  if (!booking) return { ok: false, error: "Booking tidak ditemukan." };

  const current = booking.status;

  if (next === "completed") {
    if (current === "completed") {
      return { ok: false, error: "Booking ini sudah selesai." };
    }
    if (current === "cancelled") {
      return {
        ok: false,
        error: "Booking yang sudah dibatalkan tidak dapat diselesaikan.",
      };
    }
    if (current !== "confirmed") {
      return {
        ok: false,
        error:
          "Hanya booking berstatus Dikonfirmasi yang dapat diselesaikan. Booking ini masih menunggu pembayaran.",
      };
    }
  } else {
    if (current === "cancelled") {
      return { ok: false, error: "Booking ini sudah dibatalkan." };
    }
    if (current === "completed") {
      return {
        ok: false,
        error: "Booking yang sudah selesai tidak dapat dibatalkan.",
      };
    }
    if (current !== "awaiting_payment" && current !== "confirmed") {
      return {
        ok: false,
        error: "Status booking ini tidak memungkinkan pembatalan.",
      };
    }
  }

  // Compute refund info when cancelling a confirmed booking.
  let cancelNote: string | null = null;
  if (next === "cancelled" && current === "confirmed") {
    try {
      const policy = await getCancellationPolicy();
      const refund = computeRefund(
        new Date(booking.serviceAt),
        booking.totalUsdCents,
        policy,
      );
      const refundUsd = (refund.refundUsdCents / 100).toFixed(2);
      cancelNote = `[CANCEL] Refund ${refund.refundPercent}% = $${refundUsd} (${refund.tierLabel})`;
    } catch {
      // If refund computation fails, still allow cancellation without note.
    }
  }

  // Append the cancellation note to existing notes.
  if (cancelNote) {
    const merged = `${booking.notes ?? ""}${booking.notes ? "\n" : ""}${cancelNote}`;
    await db.orm.public.Booking
      .where({ id: booking.id })
      .update({ status: next, notes: merged.slice(-2000) });
  } else {
    await db.orm.public.Booking.where({ id: booking.id }).update({ status: next });
  }

  if (next === "completed") {
    // WALLET_CREDIT_HOOK — S4 (wallet): credit the customer's wallet for this
    // booking here, inside the completed transition, after the status flip
    // succeeded. Keep it idempotent per booking id. No stock write is needed:
    // a completed booking reserves nothing, so its units are already back in
    // the available pool (src/lib/stock.ts).
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// getAdminTransactionStats
// ---------------------------------------------------------------------------

/** Per-status counts + the completed revenue (USD cents) of one line scope. */
export async function getAdminTransactionStats(
  lineSlug?: string,
): Promise<AdminTransactionStats> {
  await assertAdmin();

  const counts: Record<AdminBookingStatus, number> = {
    awaiting_payment: 0,
    confirmed: 0,
    cancelled: 0,
    completed: 0,
  };

  const productIds = lineSlug ? await lineProductIds(lineSlug) : null;
  if (productIds && productIds.length === 0) {
    return { counts, total: 0, completedTotalUsdCents: 0 };
  }

  const groups = await db.orm.public.Booking
    .where(bookingPredicate({ productIds, status: null, query: null }))
    .groupBy("status")
    .aggregate((a) => ({ n: a.count(), total: a.sum("totalUsdCents") }));

  let total = 0;
  let completedTotalUsdCents = 0;
  for (const group of groups) {
    total += group.n;
    if (isBookingStatus(group.status)) counts[group.status] = group.n;
    if (group.status === "completed") completedTotalUsdCents = group.total ?? 0;
  }

  return { counts, total, completedTotalUsdCents };
}

// ---------------------------------------------------------------------------
// confirmBooking / confirmPaymentManually
// ---------------------------------------------------------------------------

/**
 * Confirm a booking that was paid online but whose status never flipped
 * (e.g. a missed webhook). Requires a paid payment — no free confirmations.
 */
export async function confirmBooking(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertAdmin();

  const booking = await db.orm.public.Booking
    .select("id", "status")
    .where({ id })
    .first();
  if (!booking) return { ok: false, error: "Booking tidak ditemukan." };
  if (booking.status === "confirmed") {
    return { ok: false, error: "Booking ini sudah dikonfirmasi." };
  }
  if (booking.status !== "awaiting_payment") {
    return { ok: false, error: "Hanya booking menunggu pembayaran yang bisa dikonfirmasi." };
  }

  const paid = await db.orm.public.Payment
    .select("id")
    .where((f) => f.bookingId.eq(id))
    .where((f) => f.status.eq("paid"))
    .limit(1)
    .all();
  if (paid.length === 0) {
    return {
      ok: false,
      error: "Belum ada pembayaran lunas. Gunakan konfirmasi manual bila customer sudah transfer.",
    };
  }

  await db.orm.public.Booking.where({ id }).update({ status: "confirmed" });
  return { ok: true };
}

/**
 * The offline-transfer fallback: mark the latest pending payment as paid
 * (reference MANUAL-…) and confirm the booking. Seats / stock stay reserved
 * automatically — availability is derived from the active bookings.
 */
export async function confirmPaymentManually(
  bookingId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertAdmin();

  const booking = await db.orm.public.Booking
    .select("id", "status")
    .where({ id: bookingId })
    .first();
  if (!booking) return { ok: false, error: "Booking tidak ditemukan." };
  if (booking.status === "cancelled" || booking.status === "completed") {
    return { ok: false, error: "Booking sudah final — pembayaran tidak bisa dikonfirmasi." };
  }

  const pending = await db.orm.public.Payment
    .select("id")
    .where((f) => f.bookingId.eq(bookingId))
    .where((f) => f.status.eq("pending"))
    .orderBy((f) => f.createdAt.desc())
    .limit(1)
    .all();
  const payment = pending[0];
  if (!payment) {
    return { ok: false, error: "Tidak ada pembayaran pending pada booking ini." };
  }

  await db.orm.public.Payment.where({ id: payment.id }).update({
    status: "paid",
    paidAt: new Date(),
    reference: `MANUAL-${Date.now()}`,
  });
  if (booking.status === "awaiting_payment") {
    await db.orm.public.Booking.where({ id: bookingId }).update({ status: "confirmed" });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// rescheduleBooking
// ---------------------------------------------------------------------------

/**
 * Move a booking to another date / departure.
 *
 * Join-in: the new departure must belong to the same product, be open and
 * in the future, and have enough seats — the booking's own seats are given
 * back when it moves within the same departure. The departure's date +
 * start time become the authoritative serviceAt.
 *
 * Private / non-tour: any future datetime is accepted.
 */
export async function rescheduleBooking(
  id: string,
  input: { serviceAt?: string; departureId?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertAdmin();

  const booking = await db.orm.public.Booking
    .select("id", "status", "serviceAt", "departureId", "adultCount", "childCount")
    .where({ id })
    .first();
  if (!booking) return { ok: false, error: "Booking tidak ditemukan." };
  if (booking.status === "cancelled" || booking.status === "completed") {
    return { ok: false, error: "Booking sudah final — tidak bisa dijadwalkan ulang." };
  }

  const items = await db.orm.public.BookingItem
    .select("productId")
    .where((f) => f.bookingId.eq(id))
    .limit(1)
    .all();
  const productId = items[0]?.productId;

  const nextDepartureId =
    input.departureId !== undefined ? input.departureId : booking.departureId;

  let serviceAt: Date;
  if (nextDepartureId) {
    const dep = await getTourDeparture(nextDepartureId);
    if (!dep) return { ok: false, error: "Jadwal keberangkatan tidak ditemukan." };
    if (productId && dep.productId !== productId) {
      return { ok: false, error: "Jadwal ini bukan milik produk yang dipesan." };
    }
    if (dep.status !== "open") {
      return { ok: false, error: "Jadwal keberangkatan ini sudah ditutup." };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(dep.date) < today) {
      return { ok: false, error: "Jadwal keberangkatan sudah lewat." };
    }
    const seats = booking.adultCount + booking.childCount;
    const ownSeats = booking.departureId === nextDepartureId ? seats : 0;
    if (dep.available + ownSeats < seats) {
      return {
        ok: false,
        error: `Kuota tidak cukup. Tersisa ${dep.available + ownSeats} kursi untuk jadwal ini.`,
      };
    }
    serviceAt = new Date(`${dep.date.slice(0, 10)}T${dep.startTime}:00`);
  } else {
    if (!input.serviceAt) {
      return { ok: false, error: "Tanggal baru wajib diisi." };
    }
    serviceAt = new Date(input.serviceAt);
    if (!Number.isFinite(serviceAt.getTime())) {
      return { ok: false, error: "Tanggal baru tidak valid." };
    }
    if (serviceAt < new Date()) {
      return { ok: false, error: "Tanggal baru harus di masa depan." };
    }
  }

  await db.orm.public.Booking.where({ id }).update({
    serviceAt,
    departureId: nextDepartureId ?? null,
  });
  return { ok: true };
}

/** The departures of the booked product — the reschedule picker. */
export async function listDeparturesForBooking(
  bookingId: string,
): Promise<TourDepartureDTO[]> {
  await assertAdmin();
  const items = await db.orm.public.BookingItem
    .select("productId")
    .where((f) => f.bookingId.eq(bookingId))
    .limit(1)
    .all();
  const productId = items[0]?.productId;
  if (!productId) return [];
  return listTourDepartures(productId, { includeClosed: true });
}

// ---------------------------------------------------------------------------
// assignBooking — driver & vehicle with conflict checks
// ---------------------------------------------------------------------------

/**
 * Assign (or unassign with null) the driver and vehicle of a tour booking.
 * A driver / vehicle cannot serve two active bookings on the same calendar
 * day — the conflict check excludes the booking being edited.
 */
export async function assignBooking(
  id: string,
  input: { driverId?: string | null; vehicleId?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertAdmin();

  const booking = await db.orm.public.Booking
    .select("id", "status", "serviceAt")
    .where({ id })
    .first();
  if (!booking) return { ok: false, error: "Booking tidak ditemukan." };
  if (booking.status === "cancelled" || booking.status === "completed") {
    return { ok: false, error: "Booking sudah final — assignment tidak bisa diubah." };
  }

  const items = await db.orm.public.BookingItem
    .select("productId")
    .where((f) => f.bookingId.eq(id))
    .limit(1)
    .all();
  const productId = items[0]?.productId;
  if (!productId) return { ok: false, error: "Booking tidak memiliki item." };
  const product = await db.orm.public.Product
    .select("lineId")
    .where({ id: productId })
    .first();
  const line = product
    ? await db.orm.public.ServiceLine.select("slug").where({ id: product.lineId }).first()
    : null;
  if (line?.slug !== "tour-package") {
    return { ok: false, error: "Assignment driver/mobil hanya untuk booking Tour Package." };
  }

  const driverId = input.driverId ?? null;
  const vehicleId = input.vehicleId ?? null;

  if (driverId) {
    const driver = await db.orm.public.Driver
      .select("id", "active")
      .where({ id: driverId })
      .first();
    if (!driver || !driver.active) {
      return { ok: false, error: "Driver tidak ditemukan atau nonaktif." };
    }
  }
  if (vehicleId) {
    const vehicle = await db.orm.public.Vehicle
      .select("id", "active")
      .where({ id: vehicleId })
      .first();
    if (!vehicle || !vehicle.active) {
      return { ok: false, error: "Vehicle tidak ditemukan atau nonaktif." };
    }
  }

  const conflicts = await findAssignmentConflicts({
    driverId,
    vehicleId,
    serviceAt: new Date(booking.serviceAt),
    excludeBookingId: id,
  });
  if (conflicts.length > 0) {
    const codes = conflicts.map((c) => c.code).join(", ");
    return {
      ok: false,
      error: `Bentrok dengan booking ${codes} di tanggal yang sama.`,
    };
  }

  await db.orm.public.Booking.where({ id }).update({ driverId, vehicleId });
  return { ok: true };
}

/** The active roster for the assignment pickers. */
export async function listAssignmentOptions(): Promise<AssignmentOptions> {
  await assertAdmin();
  const [drivers, vehicles] = await Promise.all([
    listActiveDrivers(),
    listActiveVehicles(),
  ]);
  return { drivers, vehicles };
}

// ---------------------------------------------------------------------------
// appendOpsNote
// ---------------------------------------------------------------------------

/**
 * Append an internal operations note. The customer's special request stays
 * intact — ops notes are prefixed "[OPS]" on their own line.
 */
export async function appendOpsNote(
  id: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertAdmin();

  const text = typeof note === "string" ? note.trim() : "";
  if (!text) return { ok: false, error: "Catatan wajib diisi." };
  if (text.length > 500) return { ok: false, error: "Catatan maksimal 500 karakter." };

  const booking = await db.orm.public.Booking
    .select("id", "notes")
    .where({ id })
    .first();
  if (!booking) return { ok: false, error: "Booking tidak ditemukan." };

  const merged = `${booking.notes ?? ""}${booking.notes ? "\n" : ""}[OPS] ${text}`;
  await db.orm.public.Booking
    .where({ id })
    .update({ notes: merged.slice(-2000) });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// exportBookingsCsv
// ---------------------------------------------------------------------------

/** Escape one CSV cell — quotes doubled, always quoted. */
function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * The filtered transaction table as a CSV string (client-side download).
 * Caps at 2000 rows so one export never runs away.
 */
export async function exportBookingsCsv(input: {
  lineSlug?: string;
  status?: AdminBookingStatus;
  query?: string;
}): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  await assertAdmin();

  const header = [
    "Kode", "Status", "Tanggal Layanan", "Dibuat", "Line", "Produk",
    "Customer", "Email", "Dewasa", "Anak", "Infant", "Total USD", "Pembayaran", "Driver",
  ];

  const lines: string[] = [header.map(csvCell).join(",")];
  const pageSize = 100;
  let page = 1;
  let collected = 0;
  for (;;) {
    const result = await listAdminBookings({ ...input, page, pageSize });
    for (const row of result.rows) {
      lines.push([
        row.code,
        row.status,
        row.serviceAt,
        row.createdAt,
        row.lineLabel ?? row.lineSlug ?? "",
        row.items.map((i) => i.productTitle ?? i.label).join(" + "),
        row.customerName ?? "",
        row.customerEmail ?? "",
        row.adultCount,
        row.childCount,
        row.infantCount,
        (row.totalUsdCents / 100).toFixed(2),
        row.paymentStatus ?? "",
        row.driverName ?? "",
      ].map(csvCell).join(","));
    }
    collected += result.rows.length;
    if (collected >= result.total || result.rows.length === 0 || collected >= 2000) break;
    page += 1;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return { ok: true, csv: lines.join("\n"), filename: `transaksi-${stamp}.csv` };
}

// ---------------------------------------------------------------------------
// getBookingCancellationInfo
// ---------------------------------------------------------------------------

/**
 * Preview the refund that would apply if the booking were cancelled now.
 *
 * Returns null when the booking is not in a cancellable state.
 */
export async function getBookingCancellationInfo(
  bookingId: string,
): Promise<{
  refundUsdCents: number;
  refundPercent: number;
  tierLabel: string;
  serviceAt: string;
  hoursUntilService: number;
} | null> {
  await assertAdmin();

  if (typeof bookingId !== "string" || bookingId.trim().length === 0) {
    return null;
  }

  const booking = await db.orm.public.Booking
    .select("id", "status", "serviceAt", "totalUsdCents")
    .where({ id: bookingId })
    .first();

  if (!booking) return null;

  // Only confirmed or awaiting_payment bookings are cancellable.
  if (booking.status !== "confirmed" && booking.status !== "awaiting_payment") {
    return null;
  }

  const policy = await getCancellationPolicy();
  const refund = computeRefund(
    new Date(booking.serviceAt),
    booking.totalUsdCents,
    policy,
  );

  const now = new Date();
  const hoursUntilService =
    (new Date(booking.serviceAt).getTime() - now.getTime()) / (1000 * 60 * 60);

  return {
    refundUsdCents: refund.refundUsdCents,
    refundPercent: refund.refundPercent,
    tierLabel: refund.tierLabel,
    serviceAt: new Date(booking.serviceAt).toISOString(),
    hoursUntilService: Math.max(0, Math.round(hoursUntilService * 10) / 10),
  };
}

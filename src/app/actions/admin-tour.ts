"use server";

import { db } from "@/prisma/db";
import { getAdminSession } from "@/lib/admin/session";
import { getDepartureReservedSeats, listTourDepartures } from "@/lib/tour";
import type {
  AdminDepartureRow,
  AdminDriverRow,
  AdminOption,
  AdminVehicleRow,
} from "@/types/admin";

/**
 * Tour operations admin actions — the driver / vehicle roster and the
 * join-in departure schedule.
 *
 * Same rules as the catalog layer (`./admin-crud`): every action is gated by
 * `assertAdmin()`, writes answer with a structured result so a validation
 * failure can be shown on the field that caused it, and deletes refuse to
 * remove a row that bookings still reference.
 *
 * Seat availability is never stored — it is derived from the active bookings
 * by `src/lib/tour.ts` (the transport rental stock pattern).
 */

export type AdminTourSaveResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error: string; field?: string };

export type AdminTourStatusResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * The admin gate — mirrors `assertAdmin()` in `./admin` / `./admin-crud`.
 * It is repeated here on purpose so the "use server" module does not have to
 * export its internals.
 */
async function assertAdmin(): Promise<void> {
  if (process.env.ADMIN_ENABLED !== "1") {
    throw new Error("admin disabled");
  }
  const session = await getAdminSession();
  if (!session) {
    throw new Error("admin unauthorized");
  }
}

function fail(field: string, error: string): AdminTourSaveResult {
  return { ok: false, error, field };
}

const DEPARTURE_STATUSES = ["open", "closed", "cancelled"] as const;

// ---------------------------------------------------------------------------
// Roster — drivers
// ---------------------------------------------------------------------------

/** Create or update a driver of the operator roster. */
export async function upsertDriver(input: {
  id?: string;
  name: string;
  /** WhatsApp number in international format, e.g. "6281234567890". */
  phone: string;
  languages?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  active?: boolean;
  sortOrder?: number;
}): Promise<AdminTourSaveResult> {
  await assertAdmin();

  const name = (input.name ?? "").trim();
  if (!name) return fail("name", "Nama driver wajib diisi.");

  const phone = (input.phone ?? "").trim();
  if (!phone) return fail("phone", "Nomor WhatsApp wajib diisi.");
  if (!/^\d{8,15}$/.test(phone)) {
    return fail("phone", "Nomor WA harus format internasional, contoh 6281234567890.");
  }

  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return fail("sortOrder", "Urutan harus bilangan bulat >= 0.");
  }
  const active = input.active ?? true;

  // Editing targets the supplied row; creating always makes a new one.
  const existing = input.id
    ? await db.orm.public.Driver.select("id").where({ id: input.id }).first()
    : undefined;
  if (input.id && !existing) return fail("name", "Driver tidak ditemukan.");

  // The WhatsApp number identifies the driver — it must stay unique.
  const phoneOwner = await db.orm.public.Driver
    .select("id")
    .where({ phone })
    .first();
  if (phoneOwner && phoneOwner.id !== existing?.id) {
    return fail("phone", "Nomor WhatsApp sudah dipakai driver lain.");
  }

  const payload = {
    name,
    phone,
    languages: input.languages?.trim() || null,
    photoUrl: input.photoUrl?.trim() || null,
    notes: input.notes?.trim() || null,
    active,
    sortOrder,
  };

  if (existing) {
    await db.orm.public.Driver.where({ id: existing.id }).update(payload);
    return { ok: true, id: existing.id, message: "Driver berhasil disimpan." };
  }

  const id = input.id ?? crypto.randomUUID();
  await db.orm.public.Driver.create({ id, ...payload });
  return { ok: true, id, message: "Driver berhasil disimpan." };
}

/** All drivers (including inactive), in display order — the admin list. */
export async function listAdminDrivers(): Promise<AdminDriverRow[]> {
  await assertAdmin();
  const rows = await db.orm.public.Driver
    .select("id", "name", "phone", "languages", "photoUrl", "notes", "active", "sortOrder")
    .orderBy((f) => f.sortOrder.asc())
    .orderBy((f) => f.name.asc())
    .all();
  return rows.map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Roster — vehicles
// ---------------------------------------------------------------------------

/** Create or update a vehicle of the operator roster. */
export async function upsertVehicle(input: {
  id?: string;
  name: string;
  plateNumber?: string | null;
  seats?: number;
  photoUrl?: string | null;
  notes?: string | null;
  active?: boolean;
  sortOrder?: number;
}): Promise<AdminTourSaveResult> {
  await assertAdmin();

  const name = (input.name ?? "").trim();
  if (!name) return fail("name", "Nama kendaraan wajib diisi.");

  const seats = input.seats ?? 6;
  if (!Number.isInteger(seats) || seats < 1 || seats > 60) {
    return fail("seats", "Jumlah kursi harus antara 1 dan 60.");
  }

  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return fail("sortOrder", "Urutan harus bilangan bulat >= 0.");
  }
  const active = input.active ?? true;

  const existing = input.id
    ? await db.orm.public.Vehicle.select("id").where({ id: input.id }).first()
    : undefined;
  if (input.id && !existing) return fail("name", "Kendaraan tidak ditemukan.");

  // The plate number identifies the vehicle — it must stay unique when set.
  const plateNumber = input.plateNumber?.trim() || null;
  if (plateNumber) {
    const plateOwner = await db.orm.public.Vehicle
      .select("id")
      .where({ plateNumber })
      .first();
    if (plateOwner && plateOwner.id !== existing?.id) {
      return fail("plateNumber", "Nomor plat sudah dipakai kendaraan lain.");
    }
  }

  const payload = {
    name,
    plateNumber,
    seats,
    photoUrl: input.photoUrl?.trim() || null,
    notes: input.notes?.trim() || null,
    active,
    sortOrder,
  };

  if (existing) {
    await db.orm.public.Vehicle.where({ id: existing.id }).update(payload);
    return { ok: true, id: existing.id, message: "Kendaraan berhasil disimpan." };
  }

  const id = input.id ?? crypto.randomUUID();
  await db.orm.public.Vehicle.create({ id, ...payload });
  return { ok: true, id, message: "Kendaraan berhasil disimpan." };
}

/** All vehicles (including inactive), in display order — the admin list. */
export async function listAdminVehicles(): Promise<AdminVehicleRow[]> {
  await assertAdmin();
  const rows = await db.orm.public.Vehicle
    .select("id", "name", "plateNumber", "seats", "photoUrl", "notes", "active", "sortOrder")
    .orderBy((f) => f.sortOrder.asc())
    .orderBy((f) => f.name.asc())
    .all();
  return rows.map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Join-in departures
// ---------------------------------------------------------------------------

/**
 * Create or update a join-in departure.
 *
 * The product must belong to the tour-package line; the date is a calendar
 * day ("YYYY-MM-DD", stored at local midnight); the quota may never drop
 * below the seats already reserved by active bookings.
 */
export async function upsertTourDeparture(input: {
  id?: string;
  productId: string;
  /** Calendar day, "YYYY-MM-DD". */
  date: string;
  /** Local start time, "HH:MM" — defaults to "08:00". */
  startTime?: string;
  quota?: number;
  status?: string;
  notes?: string | null;
}): Promise<AdminTourSaveResult> {
  await assertAdmin();

  const productId = (input.productId ?? "").trim();
  if (!productId) return fail("productId", "Produk tour wajib dipilih.");

  const product = await db.orm.public.Product
    .select("id", "lineId")
    .where({ id: productId })
    .first();
  if (!product) return fail("productId", "Produk tidak ditemukan.");
  const line = await db.orm.public.ServiceLine
    .select("slug")
    .where({ id: product.lineId })
    .first();
  if (line?.slug !== "tour-package") {
    return fail("productId", "Departure hanya untuk produk dari line Tour Package.");
  }

  const dateText = (input.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return fail("date", "Tanggal harus format YYYY-MM-DD.");
  }
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fail("date", "Tanggal tidak valid.");

  const startTime = (input.startTime ?? "").trim() || "08:00";
  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    return fail("startTime", "Jam mulai harus format HH:MM.");
  }
  const [hours, minutes] = startTime.split(":").map(Number);
  if (hours > 23 || minutes > 59) {
    return fail("startTime", "Jam mulai harus format HH:MM.");
  }

  const quota = input.quota ?? 10;
  if (!Number.isInteger(quota) || quota < 1 || quota > 99) {
    return fail("quota", "Kuota harus antara 1 dan 99.");
  }

  const status = (input.status ?? "").trim() || "open";
  if (!(DEPARTURE_STATUSES as readonly string[]).includes(status)) {
    return fail("status", "Status harus open, closed atau cancelled.");
  }

  const existing = input.id
    ? await db.orm.public.TourDeparture.select("id").where({ id: input.id }).first()
    : undefined;
  if (input.id && !existing) return fail("productId", "Jadwal keberangkatan tidak ditemukan.");

  // One departure per product / day / start time.
  const slotOwner = await db.orm.public.TourDeparture
    .select("id")
    .where({ productId, date, startTime })
    .first();
  if (slotOwner && slotOwner.id !== existing?.id) {
    return fail("date", "Jadwal dengan jam yang sama sudah ada untuk produk dan tanggal ini.");
  }

  // Never shrink the quota below the seats already reserved.
  if (existing) {
    const reserved = await getDepartureReservedSeats([existing.id]);
    const used = reserved.get(existing.id) ?? 0;
    if (quota < used) {
      return fail("quota", `Kuota tidak boleh lebih kecil dari kursi terisi (${used}).`);
    }
  }

  const payload = {
    productId,
    date,
    startTime,
    quota,
    status,
    notes: input.notes?.trim() || null,
  };

  if (existing) {
    await db.orm.public.TourDeparture.where({ id: existing.id }).update(payload);
    return { ok: true, id: existing.id, message: "Jadwal keberangkatan berhasil disimpan." };
  }

  const id = input.id ?? crypto.randomUUID();
  await db.orm.public.TourDeparture.create({ id, ...payload });
  return { ok: true, id, message: "Jadwal keberangkatan berhasil disimpan." };
}

/**
 * Departures with seat availability and the product title — the admin list.
 *
 * Without `productId` every tour-line product is included. Past departures
 * are returned too (the admin needs the full history); `includeClosed` also
 * returns closed / cancelled schedules.
 */
export async function listAdminDepartures(
  productId?: string,
): Promise<AdminDepartureRow[]> {
  await assertAdmin();

  const opts = { includeClosed: true, fromDate: new Date(0) };

  if (productId) {
    const product = await db.orm.public.Product
      .select("id", "title")
      .where({ id: productId })
      .first();
    if (!product) return [];
    const departures = await listTourDepartures(product.id, opts);
    return departures.map((d) => ({ ...d, productTitle: product.title }));
  }

  const line = await db.orm.public.ServiceLine
    .select("id")
    .where({ slug: "tour-package" })
    .first();
  if (!line) return [];

  const products = await db.orm.public.Product
    .select("id", "title")
    .where({ lineId: line.id })
    .orderBy((f) => f.title.asc())
    .all();

  const lists = await Promise.all(
    products.map(async (p) => {
      const departures = await listTourDepartures(p.id, opts);
      return departures.map((d) => ({ ...d, productTitle: p.title }));
    }),
  );

  return lists
    .flat()
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.startTime.localeCompare(b.startTime) ||
        a.productTitle.localeCompare(b.productTitle),
    );
}

/** Open / close / cancel a departure without touching its other fields. */
export async function setDepartureStatus(input: {
  id: string;
  status: string;
}): Promise<AdminTourStatusResult> {
  await assertAdmin();

  const status = (input.status ?? "").trim();
  if (!(DEPARTURE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Status harus open, closed atau cancelled." };
  }

  const row = await db.orm.public.TourDeparture
    .select("id")
    .where({ id: input.id })
    .first();
  if (!row) return { ok: false, error: "Jadwal keberangkatan tidak ditemukan." };

  await db.orm.public.TourDeparture.where({ id: row.id }).update({ status });
  return { ok: true, message: "Status jadwal diperbarui." };
}

// ---------------------------------------------------------------------------
// Reference data for the tour forms
// ---------------------------------------------------------------------------

/**
 * The pickers of the tour forms: the tour-package line id (to show the Tour
 * section only for that line), the destination places and the tour products.
 */
export async function getTourAdminReferenceData(): Promise<{
  tourLineId: string | null;
  destinations: AdminOption[];
  tourProducts: AdminOption[];
}> {
  await assertAdmin();

  const line = await db.orm.public.ServiceLine
    .select("id")
    .where({ slug: "tour-package" })
    .first();

  const places = await db.orm.public.Airport
    .select("id", "name")
    .where((f) => f.kind.eq("destination"))
    .where((f) => f.active.eq(true))
    .orderBy((f) => f.name.asc())
    .all();

  const products = line
    ? await db.orm.public.Product
        .select("id", "title", "tourKind")
        .where({ lineId: line.id })
        .orderBy((f) => f.title.asc())
        .all()
    : [];

  return {
    tourLineId: line?.id ?? null,
    destinations: places.map((p) => ({ value: p.id, label: p.name })),
    tourProducts: products.map((p) => ({
      value: p.id,
      label:
        p.tourKind === "join_in"
          ? `${p.title} · Join-in`
          : p.tourKind === "private"
            ? `${p.title} · Private`
            : p.title,
    })),
  };
}

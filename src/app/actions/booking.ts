"use server";

import { db } from "@/prisma/db";
import { getUserSession } from "@/lib/user/session";
import { checkPromo, markPromoUsed } from "@/lib/promo";
import { computeTaxesFor } from "@/lib/tax";
import { generateInvoiceNumber } from "@/lib/invoice";
import { assertStockAvailable, getAvailableStock } from "@/lib/stock";
import {
  assertDepartureSeats,
  getTourDeparture,
  getTourProductRules,
} from "@/lib/tour";
import type {
  BookingLookupDTO,
  BookingLookupResult,
  CreateBookingInput,
  CreateBookingResult,
} from "@/types";
import type { TourItineraryDay } from "@/types/tour";

/** Generate a BV- code with 6 chars from unambiguous alphabet. */
function generateBookingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/1/I/O
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i]! % alphabet.length];
  }
  return "BV-" + code;
}

/** Check if a booking code exists. */
async function codeExists(code: string): Promise<boolean> {
  const existing = await db.orm.public.Booking
    .select("id")
    .where((f) => f.code.eq(code))
    .limit(1)
    .all();
  return existing.length > 0;
}

/** Generate a unique code with up to 3 retries. */
async function generateUniqueCode(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateBookingCode();
    const exists = await codeExists(code);
    if (!exists) return code;
  }
  return null;
}

/**
 * The result of an earlier booking created with the same idempotency key,
 * or null when no booking carries the key.
 */
async function findBookingByIdempotencyKey(
  key: string
): Promise<CreateBookingResult | null> {
  const rows = await db.orm.public.Booking
    .select("code", "totalUsdCents", "invoiceNumber")
    .where((f) => f.idempotencyKey.eq(key))
    .limit(1)
    .all();
  const prior = rows[0];
  if (!prior) return null;
  return {
    ok: true,
    code: prior.code,
    totalUsdCents: prior.totalUsdCents,
    invoiceNumber: prior.invoiceNumber ?? "",
  };
}

/** Generate an invoice number that is not taken yet. */
async function generateUniqueInvoiceNumber(): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = generateInvoiceNumber();
    const existing = await db.orm.public.Booking
      .select("id")
      .where((f) => f.invoiceNumber.eq(number))
      .limit(1)
      .all();
    if (existing.length === 0) return number;
  }
  return null;
}

/** Generate a unique VOA- application code (same alphabet as booking codes). */
async function generateUniqueVisaCode(): Promise<string | null> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/1/I/O
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let suffix = "";
    for (let i = 0; i < 6; i++) {
      suffix += alphabet[bytes[i]! % alphabet.length];
    }
    const code = "VOA-" + suffix;
    const existing = await db.orm.public.VisaApplication
      .select("id")
      .where((f) => f.code.eq(code))
      .limit(1)
      .all();
    if (existing.length === 0) return code;
  }
  return null;
}

/** The private-storage key shape the passport upload route produces. */
const PASSPORT_KEY_RE = /^passports\/[0-9a-f-]+\.(jpg|png|webp|pdf)$/;

/** Six calendar months after a date — the minimum passport validity rule. */
function plusSixMonths(date: Date): Date {
  const min = new Date(date.getTime());
  min.setMonth(min.getMonth() + 6);
  return min;
}

/**
 * The cart path of createBooking — several transport rental lines in ONE
 * booking (one invoice, one payment).
 *
 * Every line must be a transport-line product with an active "per_day"
 * package. Days default to 1 (1..365), the per-line vehicle count to 1
 * (1..99). Stock is checked per product over the SUM of the cart's lines
 * for that product, pricing is Σ(unit × days × count), and promo / taxes
 * apply to the cart gross exactly like the single-product path.
 */
async function createCartBooking(
  input: CreateBookingInput,
  idempotencyKey: string
): Promise<CreateBookingResult> {
  const lines = input.items!;

  // 1. Resolve every product — active and not an add-on.
  const slugs = [...new Set(lines.map((l) => l.productSlug))];
  const products = await db.orm.public.Product
    .select("id", "slug", "title", "leadTimeHours", "leadTimeDays", "lineId")
    .where((f) => f.slug.in(slugs))
    .where((f) => f.active.eq(true))
    .where((f) => f.isAddOn.eq(false))
    .all();
  const productBySlug = new Map(products.map((p) => [p.slug, p]));
  for (const line of lines) {
    if (!productBySlug.has(line.productSlug)) {
      return {
        ok: false,
        error: `Produk tidak ditemukan atau tidak aktif: ${line.productSlug}`,
      };
    }
  }

  // 2. Every product must belong to the transport service line.
  const lineIds = [...new Set(products.map((p) => p.lineId))];
  const serviceLines = await db.orm.public.ServiceLine
    .select("id", "slug")
    .where((f) => f.id.in(lineIds))
    .all();
  const lineSlugById = new Map(serviceLines.map((l) => [l.id, l.slug]));
  for (const product of products) {
    if (lineSlugById.get(product.lineId) !== "transport") {
      return {
        ok: false,
        error: `Keranjang hanya untuk sewa mobil (transport): ${product.title}`,
      };
    }
  }

  // 3. Resolve every package and validate each line.
  const packageIds = [...new Set(lines.map((l) => l.packageId))];
  const packages = await db.orm.public.ProductPackage
    .select("id", "productId", "label", "unitKind", "unitUsdCents")
    .where((f) => f.id.in(packageIds))
    .where((f) => f.active.eq(true))
    .all();
  const packageById = new Map(packages.map((p) => [p.id, p]));

  const resolved: {
    product: (typeof products)[number];
    pkg: (typeof packages)[number];
    days: number;
    vehicleCount: number;
    totalUsdCents: number;
  }[] = [];
  for (const line of lines) {
    const product = productBySlug.get(line.productSlug)!;
    const pkg = packageById.get(line.packageId);
    if (!pkg || pkg.productId !== product.id) {
      return {
        ok: false,
        error: `Paket tidak ditemukan atau tidak aktif untuk ${product.title}`,
      };
    }
    if (pkg.unitKind !== "per_day") {
      return {
        ok: false,
        error: `Hanya paket sewa harian (per_day) yang bisa dipesan lewat keranjang: ${product.title}`,
      };
    }
    const days = line.days ?? 1;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return { ok: false, error: "Jumlah hari sewa harus antara 1 dan 365" };
    }
    const vehicleCount = line.vehicleCount ?? 1;
    if (!Number.isInteger(vehicleCount) || vehicleCount < 1 || vehicleCount > 99) {
      return { ok: false, error: "Jumlah mobil harus antara 1 dan 99" };
    }
    resolved.push({
      product,
      pkg,
      days,
      vehicleCount,
      totalUsdCents: (pkg.unitUsdCents ?? 0) * days * vehicleCount,
    });
  }

  // 4. Aggregate stock check — two cart lines of the same car reserve
  // together, so their counts are summed before comparing to the stock.
  const countByProduct = new Map<string, number>();
  for (const r of resolved) {
    countByProduct.set(
      r.product.id,
      (countByProduct.get(r.product.id) ?? 0) + r.vehicleCount,
    );
  }
  const stock = await getAvailableStock([...countByProduct.keys()]);
  for (const [productId, count] of countByProduct) {
    const available = stock.get(productId) ?? 0;
    if (count > available) {
      const title = products.find((p) => p.id === productId)?.title ?? "";
      return {
        ok: false,
        error: `Stok mobil tidak cukup untuk ${title}. Tersisa ${available} unit.`,
      };
    }
  }

  // 5. Validate serviceAt (valid, future, and every product's lead time).
  const serviceAt = new Date(input.serviceAt);
  if (!Number.isFinite(serviceAt.getTime())) {
    return { ok: false, error: "Invalid service date" };
  }
  const now = new Date();
  if (serviceAt < now) {
    return { ok: false, error: "Service date must be in the future" };
  }
  for (const product of products) {
    if (product.leadTimeDays > 0) {
      const minDate = new Date(now.getTime() + product.leadTimeDays * 24 * 60 * 60 * 1000);
      if (serviceAt < minDate) {
        return { ok: false, error: `Service requires at least ${product.leadTimeDays} day(s) lead time` };
      }
    } else if (product.leadTimeHours > 0) {
      const minDate = new Date(now.getTime() + product.leadTimeHours * 60 * 60 * 1000);
      if (serviceAt < minDate) {
        return { ok: false, error: `Service requires at least ${product.leadTimeHours} hour(s) lead time` };
      }
    }
  }

  // 6. Validate the passenger counts (same rules as the single-product path).
  if (!Number.isFinite(input.adult) || input.adult < 1) {
    return { ok: false, error: "At least 1 adult is required" };
  }
  if (!Number.isFinite(input.child) || input.child < 0) {
    return { ok: false, error: "Child count must be 0 or greater" };
  }
  if (!Number.isFinite(input.infant) || input.infant < 0) {
    return { ok: false, error: "Infant count must be 0 or greater" };
  }
  const travelers = input.travelers ?? [];
  if (travelers.length > 0) {
    const expectedTravelers = input.adult + input.child;
    if (travelers.length !== expectedTravelers) {
      return { ok: false, error: `Expected ${expectedTravelers} traveler(s), got ${travelers.length}` };
    }
  }

  // Add-ons are linked to a single host product — the cart does not carry
  // them (the transport cart UI always sends an empty list).
  if (input.addOns.length > 0) {
    return { ok: false, error: "Add-on belum didukung untuk pesanan multi-mobil." };
  }

  // 7. Recompute the totals server-side from DB cents — the cart gross is
  // the sum of the line totals; promo and taxes apply to it as usual.
  const subtotalUsdCents = resolved.reduce((sum, r) => sum + r.totalUsdCents, 0);
  const addOnsUsdCents = 0;
  const grossUsdCents = subtotalUsdCents + addOnsUsdCents;
  const vehicleCount = resolved.reduce((sum, r) => sum + r.vehicleCount, 0);

  const userSession = await getUserSession();

  let discountUsdCents = 0;
  let appliedPromoId: string | null = null;
  const promoInput = input.promoCode?.trim();
  if (promoInput) {
    const check = await checkPromo(
      promoInput,
      grossUsdCents,
      new Date(),
      userSession?.uid ?? null,
    );
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    discountUsdCents = check.discountUsdCents;
    appliedPromoId = check.promo.id;
  }

  const taxableUsdCents = Math.max(0, grossUsdCents - discountUsdCents);
  const taxes = await computeTaxesFor(taxableUsdCents);
  const totalUsdCents = taxableUsdCents + taxes.totalUsdCents;

  // 8. One booking code and one invoice number for the whole cart.
  const code = await generateUniqueCode();
  if (!code) {
    return { ok: false, error: "Could not generate unique booking code. Please try again." };
  }
  const invoiceNumber = await generateUniqueInvoiceNumber();
  if (!invoiceNumber) {
    return { ok: false, error: "Could not generate an invoice number. Please try again." };
  }

  // Sequential inserts with compensating deletes on failure — the same
  // sequence as the single-product path, with one BookingItem per line.
  const bookingId = crypto.randomUUID();

  try {
    // 1. Booking — vehicleCount is the sum of the cart's line counts.
    try {
      await db.orm.public.Booking.create({
        id: bookingId,
        code,
        status: "awaiting_payment",
        serviceAt,
        adultCount: input.adult,
        childCount: input.child,
        infantCount: input.infant,
        vehicleCount,
        subtotalUsdCents,
        addOnsUsdCents,
        totalUsdCents,
        userId: userSession?.uid ?? null,
        invoiceNumber,
        idempotencyKey: idempotencyKey || null,
        promoCode: appliedPromoId ? promoInput!.toUpperCase() : null,
        discountUsdCents,
        taxes: taxes.lines as never,
        taxUsdCents: taxes.totalUsdCents,
        pickupLabel: input.pickup?.label ?? null,
        pickupLat: input.pickup?.lat ?? null,
        pickupLng: input.pickup?.lng ?? null,
        dropoffLabel: input.dropoff?.label ?? null,
        dropoffLat: input.dropoff?.lat ?? null,
        dropoffLng: input.dropoff?.lng ?? null,
      });
    } catch (bookingError) {
      // A concurrent request with the same idempotency key won the insert
      // race — return its booking instead of creating a duplicate.
      if (idempotencyKey) {
        const prior = await findBookingByIdempotencyKey(idempotencyKey);
        if (prior) return prior;
      }
      throw bookingError;
    }

    // 2. BookingItem — one per cart line. quantity stores the rental days,
    // vehicleCount the units this line reserves (the stock aggregate sums
    // it per product).
    for (const r of resolved) {
      await db.orm.public.BookingItem.create({
        id: crypto.randomUUID(),
        bookingId,
        productId: r.product.id,
        packageId: r.pkg.id,
        label: r.product.title,
        packageLabel: r.pkg.label,
        unitKind: r.pkg.unitKind,
        adultCount: input.adult,
        childCount: input.child,
        infantCount: input.infant,
        quantity: r.days,
        vehicleCount: r.vehicleCount,
        unitUsdCents: r.pkg.unitUsdCents ?? 0,
        totalUsdCents: r.totalUsdCents,
      });
    }

    // 3. Contact (normalize: trim names, lowercase+trim email).
    const contactId = crypto.randomUUID();
    const rawIdType = input.contact.idType;
    const idType =
      rawIdType === "ktp" || rawIdType === "ssn" || rawIdType === "passport"
        ? rawIdType
        : null;
    await db.orm.public.Contact.create({
      id: contactId,
      bookingId,
      firstName: input.contact.firstName.trim(),
      lastName: input.contact.lastName.trim(),
      email: input.contact.email.trim().toLowerCase(),
      phoneCountryCode: input.contact.phoneCountryCode,
      phone: input.contact.phone,
      isGuestSelf: input.contact.isGuestSelf,
      notes: input.contact.notes ?? null,
      identityNumber: input.contact.identityNumber?.trim() || null,
      idType,
      idDocumentUrl: input.contact.idDocumentUrl || null,
      signatureUrl: input.contact.signatureUrl || null,
    });

    // 4. Traveler* (normalize names).
    for (let i = 0; i < travelers.length; i++) {
      const traveler = travelers[i];
      if (traveler) {
        await db.orm.public.Traveler.create({
          id: crypto.randomUUID(),
          bookingId,
          fullName: traveler.fullName.trim(),
          kind: traveler.kind,
          sortOrder: i,
        });
      }
    }

    // 5. FlightDetails (empty for the transport cart).
    await db.orm.public.FlightDetails.create({
      id: crypto.randomUUID(),
      bookingId,
      airportName: input.flight.airportName ?? null,
      location: input.flight.location ?? null,
      airline: input.flight.airline ?? null,
      flightCode: input.flight.flightCode ?? null,
      direction: input.flight.direction ?? null,
    });

    // 6. Payment — ONE placeholder payment for the whole cart.
    await db.orm.public.Payment.create({
      id: crypto.randomUUID(),
      bookingId,
      methodId: null,
      status: "pending",
      amountUsdCents: totalUsdCents,
    });

    // 7. The rental extras — pickup policy, driver option, customer note.
    try {
      const patch: Record<string, unknown> = {};
      if (input.notes) patch.notes = input.notes;
      if (input.pickupPolicy) patch.pickupPolicy = input.pickupPolicy;
      if (input.driverOption) patch.driverOption = input.driverOption;
      if (Object.keys(patch).length > 0) {
        await db.orm.public.Booking
          .where((f) => f.id.eq(bookingId))
          .update(patch as never);
      }
      if (input.contact.title) {
        await db.orm.public.Contact
          .where((f) => f.id.eq(contactId))
          .update({ title: input.contact.title } as never);
      }
    } catch (extraError) {
      console.error("[booking] could not store the booking extras", extraError);
    }

    // 8. Count the promo usage.
    if (appliedPromoId) {
      try {
        await markPromoUsed(appliedPromoId);
      } catch (usageError) {
        console.error("[booking] could not count promo usage", usageError);
      }
    }

    return { ok: true, code, totalUsdCents, invoiceNumber };
  } catch (insertError) {
    // Compensating deletes — cover every cart line.
    console.error("[booking] cart insert failed, rolling back", insertError);
    try {
      await db.orm.public.Payment.where((f) => f.bookingId.eq(bookingId)).deleteAll();
      await db.orm.public.FlightDetails.where((f) => f.bookingId.eq(bookingId)).deleteAll();
      await db.orm.public.Traveler.where((f) => f.bookingId.eq(bookingId)).deleteAll();
      await db.orm.public.Contact.where((f) => f.bookingId.eq(bookingId)).deleteAll();
      await db.orm.public.BookingAddOn.where((f) => f.bookingId.eq(bookingId)).deleteAll();
      await db.orm.public.BookingItem.where((f) => f.bookingId.eq(bookingId)).deleteAll();
      await db.orm.public.Booking.where((f) => f.id.eq(bookingId)).deleteAll();
    } catch (rollbackError) {
      console.error("[booking] rollback failed", rollbackError);
    }
    return { ok: false, error: "Failed to create booking. Please try again." };
  }
}

/**
 * Create a new booking with all related records.
 * Errors surface — never swallowed.
 */
export async function createBooking(
  input: CreateBookingInput
): Promise<CreateBookingResult> {
  try {
    // Idempotency — a retry carrying the same client-generated key returns
    // the original booking immediately, without creating any new rows.
    const idempotencyKey =
      typeof input.idempotencyKey === "string"
        ? input.idempotencyKey.trim().slice(0, 100)
        : "";
    if (idempotencyKey) {
      const prior = await findBookingByIdempotencyKey(idempotencyKey);
      if (prior) return prior;
    }

    // Cart path — a multi-car transport order: one booking, one item per
    // cart line, one invoice and one payment. The legacy single-product
    // fields below are only used when no cart was sent.
    if (input.items && input.items.length > 0) {
      return createCartBooking(input, idempotencyKey);
    }

    // Validate product exists, is active, and is not an add-on
    const products = await db.orm.public.Product
      .select("id", "slug", "leadTimeHours", "leadTimeDays", "lineId", "isAddOn")
      .where((f) => f.slug.eq(input.productSlug))
      .where((f) => f.active.eq(true))
      .where((f) => f.isAddOn.eq(false))
      .limit(1)
      .all();

    const product = products[0];
    if (!product) {
      return { ok: false, error: "Product not found or inactive" };
    }

    // Validate package — check if product has active packages first
    const allActivePackages = await db.orm.public.ProductPackage
      .select("id")
      .where((f) => f.productId.eq(product.id))
      .where((f) => f.active.eq(true))
      .all();

    if (allActivePackages.length === 0) {
      return { ok: false, error: "Product has no active packages available for booking" };
    }

    // packageId is required when product has active packages
    if (!input.packageId) {
      return { ok: false, error: "Package selection is required" };
    }

    let packageRecord: { id: string; label: string; unitKind: string; adultUsdCents: number | null; childUsdCents: number | null; infantUsdCents: number | null; unitUsdCents: number | null } | null = null;
    {
      const packageId = input.packageId; // narrow to string
      const packages = await db.orm.public.ProductPackage
        .select("id", "label", "unitKind", "adultUsdCents", "childUsdCents", "infantUsdCents", "unitUsdCents")
        .where((f) => f.id.eq(packageId))
        .where((f) => f.productId.eq(product.id))
        .where((f) => f.active.eq(true))
        .limit(1)
        .all();
      packageRecord = packages[0] ?? null;
      if (!packageRecord) {
        return { ok: false, error: "Package not found or inactive" };
      }
    }

    // Resolve the service line of the product — the vehicle count applies
    // only to the transport line's daily rentals.
    const lines = await db.orm.public.ServiceLine
      .select("slug")
      .where((f) => f.id.eq(product.lineId))
      .limit(1)
      .all();
    const isTransport = lines[0]?.slug === "transport";

    // Validate the vehicle count (transport rentals) — default 1, integer 1-99.
    let vehicleCount = input.vehicleCount ?? 1;
    if (!Number.isInteger(vehicleCount) || vehicleCount < 1 || vehicleCount > 99) {
      return { ok: false, error: "Jumlah mobil harus antara 1 dan 99" };
    }
    // Only daily transport rentals reserve multiple units — every other
    // line and every per_pax / per_unit package books exactly one.
    if (!isTransport || packageRecord?.unitKind !== "per_day") {
      vehicleCount = 1;
    }
    if (isTransport) {
      const stock = await assertStockAvailable(product.id, vehicleCount);
      if (!stock.ok) {
        return { ok: false, error: stock.error };
      }
    }

    // Tour products — resolve the rules and, for join-in tours, the
    // scheduled departure. The departure's date + start time become the
    // authoritative service time (the client's time is ignored). Private
    // tours ignore any departureId the client sends — they book no seats.
    const tourRules = await getTourProductRules(product.id);
    let tourDepartureId: string | null = null;
    let tourServiceAt: Date | null = null;
    if (tourRules?.tourKind === "join_in") {
      if (!input.departureId) {
        return { ok: false, error: "Pilih jadwal keberangkatan dulu." };
      }
      const departure = await getTourDeparture(input.departureId);
      if (!departure || departure.productId !== product.id) {
        return { ok: false, error: "Jadwal keberangkatan tidak ditemukan." };
      }
      tourDepartureId = departure.id;
      const [hh, mm] = departure.startTime.split(":");
      const at = new Date(departure.date);
      at.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
      tourServiceAt = at;
    }

    // Validate serviceAt is a valid date — a join-in departure overrides it.
    let serviceAt = new Date(input.serviceAt);
    if (tourServiceAt) {
      serviceAt = tourServiceAt;
    } else if (!Number.isFinite(serviceAt.getTime())) {
      return { ok: false, error: "Invalid service date" };
    }

    // Validate serviceAt is in the future (at least current second)
    const now = new Date();
    if (serviceAt < now) {
      return { ok: false, error: "Service date must be in the future" };
    }

    // Validate lead time
    if (product.leadTimeDays > 0) {
      const minDate = new Date(now.getTime() + product.leadTimeDays * 24 * 60 * 60 * 1000);
      if (serviceAt < minDate) {
        return { ok: false, error: `Service requires at least ${product.leadTimeDays} day(s) lead time` };
      }
    } else if (product.leadTimeHours > 0) {
      const minDate = new Date(now.getTime() + product.leadTimeHours * 60 * 60 * 1000);
      if (serviceAt < minDate) {
        return { ok: false, error: `Service requires at least ${product.leadTimeHours} hour(s) lead time` };
      }
    }

    // Validate adult count (NaN-safe)
    if (!Number.isFinite(input.adult) || input.adult < 1) {
      return { ok: false, error: "At least 1 adult is required" };
    }

    // Validate child count (NaN-safe, clamp negative to 0)
    if (!Number.isFinite(input.child) || input.child < 0) {
      return { ok: false, error: "Child count must be 0 or greater" };
    }

    // Validate infant count (NaN-safe, clamp negative to 0)
    if (!Number.isFinite(input.infant) || input.infant < 0) {
      return { ok: false, error: "Infant count must be 0 or greater" };
    }

    // Tour party size — only adults and children occupy (paying) seats;
    // infants ride along. Join-in bookings must also fit the departure quota.
    if (tourRules?.tourKind) {
      const payingPax = input.adult + input.child;
      if (payingPax < tourRules.minPax) {
        return { ok: false, error: `Minimal ${tourRules.minPax} penumpang untuk paket ini.` };
      }
      if (tourRules.maxPax != null && payingPax > tourRules.maxPax) {
        return { ok: false, error: `Maksimal ${tourRules.maxPax} penumpang per booking.` };
      }
      if (tourDepartureId) {
        const seats = await assertDepartureSeats(tourDepartureId, payingPax);
        if (!seats.ok) {
          return { ok: false, error: seats.error };
        }
      }
    }

    // Validate units (for per_unit packages) — default 1, range 1-99
    const units = input.units ?? 1;
    if (!Number.isFinite(units) || units < 1 || units > 99) {
      return { ok: false, error: "Quantity must be between 1 and 99" };
    }

    // The number of rental days (for the "per_day" packages) — default 1.
    const days = input.days ?? 1;
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return { ok: false, error: "Jumlah hari sewa harus antara 1 dan 365" };
    }

    // Validate travelers count matches adult + child — only when the names
    // were given (the transport flow only asks for the number of passengers).
    const travelers = input.travelers ?? [];
    if (travelers.length > 0) {
      const expectedTravelers = input.adult + input.child;
      if (travelers.length !== expectedTravelers) {
        return { ok: false, error: `Expected ${expectedTravelers} traveler(s), got ${travelers.length}` };
      }
    }

    // Validate the optional passport data (airport VIP flow). Every field is
    // optional — the transport/tour flows never send them — but anything that
    // IS sent must be usable: a real date, an expiry at least six months
    // after the service date, and a photo key our upload route produced.
    const minPassportExpiry = plusSixMonths(serviceAt);
    for (let i = 0; i < travelers.length; i++) {
      const traveler = travelers[i];
      if (!traveler) continue;
      const label = traveler.fullName?.trim() || `Traveler ${i + 1}`;

      if (traveler.dateOfBirth) {
        const dob = new Date(traveler.dateOfBirth);
        if (!Number.isFinite(dob.getTime())) {
          return { ok: false, error: `Invalid date of birth for ${label}` };
        }
      }
      if (traveler.passportExpiry) {
        const expiry = new Date(traveler.passportExpiry);
        if (!Number.isFinite(expiry.getTime())) {
          return { ok: false, error: `Invalid passport expiry date for ${label}` };
        }
        if (expiry < minPassportExpiry) {
          return {
            ok: false,
            error: `Passport for ${label} must be valid for at least 6 months after the service date`,
          };
        }
      }
      if (traveler.passportPhotoKey && !PASSPORT_KEY_RE.test(traveler.passportPhotoKey)) {
        return { ok: false, error: `Invalid passport photo reference for ${label}` };
      }
    }

    // Resolve add-ons
    const addOnRecords: { id: string; slug: string; label: string; unitUsdCents: number | null }[] = [];
    if (input.addOns.length > 0) {
      const addOnSlugs = input.addOns.map((a) => a.slug);
      // Verify add-ons are linked to this product
      const joins = await db.orm.public.ProductAddOn
        .select("addOnId")
        .where((f) => f.productId.eq(product.id))
        .all();
      const linkedAddOnIds = joins.map((j) => j.addOnId);

      const addOnProducts = await db.orm.public.Product
        .select("id", "slug", "title", "fromPriceUsdCents")
        .where((f) => f.slug.in(addOnSlugs))
        .where((f) => f.active.eq(true))
        .all();

      for (const addOnInput of input.addOns) {
        const addOnProduct = addOnProducts.find((p) => p.slug === addOnInput.slug);
        if (!addOnProduct) {
          return { ok: false, error: `Add-on not found: ${addOnInput.slug}` };
        }
        if (!linkedAddOnIds.includes(addOnProduct.id)) {
          return { ok: false, error: `Add-on not available for this product: ${addOnInput.slug}` };
        }
        if (addOnInput.qty < 1 || addOnInput.qty > 10) {
          return { ok: false, error: `Add-on quantity must be between 1 and 10: ${addOnInput.slug}` };
        }
        addOnRecords.push({
          id: addOnProduct.id,
          slug: addOnProduct.slug,
          label: addOnProduct.title,
          unitUsdCents: addOnProduct.fromPriceUsdCents,
        });
      }
    }

    // Recompute totals server-side from DB cents
    let subtotalUsdCents = 0;
    let addOnsUsdCents = 0;

    // Calculate package subtotal
    if (packageRecord) {
      if (packageRecord.unitKind === "per_pax") {
        subtotalUsdCents += (packageRecord.adultUsdCents ?? 0) * input.adult;
        subtotalUsdCents += (packageRecord.childUsdCents ?? 0) * input.child;
        subtotalUsdCents += (packageRecord.infantUsdCents ?? 0) * input.infant;
      } else if (packageRecord.unitKind === "per_day") {
        // per_day: the price of one day × the number of days × the number
        // of vehicles reserved.
        subtotalUsdCents += (packageRecord.unitUsdCents ?? 0) * days * vehicleCount;
      } else {
        // per_unit: multiply by units (quantity)
        subtotalUsdCents += (packageRecord.unitUsdCents ?? 0) * units;
      }
    }

    // Calculate add-ons
    for (const addOn of input.addOns) {
      const addOnRec = addOnRecords.find((r) => r.slug === addOn.slug);
      if (addOnRec) {
        addOnsUsdCents += (addOnRec.unitUsdCents ?? 0) * addOn.qty;
      }
    }

    const grossUsdCents = subtotalUsdCents + addOnsUsdCents;

    // The signed-in customer (null for guests) — needed before the promo
    // check so a reward voucher can be matched against its owner.
    const userSession = await getUserSession();

    // Apply the promo code (if any). The discount can never exceed the total.
    // Reward vouchers are re-validated here server-side: ownership, expiry,
    // the usage limit and the stored value — the client never decides them.
    let discountUsdCents = 0;
    let appliedPromoId: string | null = null;

    const promoInput = input.promoCode?.trim();
    if (promoInput) {
      const check = await checkPromo(
        promoInput,
        grossUsdCents,
        new Date(),
        userSession?.uid ?? null,
      );
      if (!check.ok) {
        return { ok: false, error: check.error };
      }
      discountUsdCents = check.discountUsdCents;
      appliedPromoId = check.promo.id;
    }

    // Taxes are computed on the discounted amount.
    const taxableUsdCents = Math.max(0, grossUsdCents - discountUsdCents);
    const taxes = await computeTaxesFor(taxableUsdCents);

    const totalUsdCents = taxableUsdCents + taxes.totalUsdCents;

    // Generate unique code
    const code = await generateUniqueCode();
    if (!code) {
      return { ok: false, error: "Could not generate unique booking code. Please try again." };
    }

    // The invoice number — `#INV/YYYY/MM/DD/4DIGIT/2RANDOM`.
    const invoiceNumber = await generateUniqueInvoiceNumber();
    if (!invoiceNumber) {
      return { ok: false, error: "Could not generate an invoice number. Please try again." };
    }

    // Sequential inserts with compensating deletes on failure
    const bookingId = crypto.randomUUID();

    try {
      // 1. Booking
      // Link the booking to the signed-in customer (null for guests).
      try {
        await db.orm.public.Booking.create({
          id: bookingId,
          code,
          status: "awaiting_payment",
          serviceAt,
          adultCount: input.adult,
          childCount: input.child,
          infantCount: input.infant,
          vehicleCount,
          subtotalUsdCents,
          addOnsUsdCents,
          totalUsdCents,
          userId: userSession?.uid ?? null,
          invoiceNumber,
          idempotencyKey: idempotencyKey || null,
          promoCode: appliedPromoId ? promoInput!.toUpperCase() : null,
          discountUsdCents,
          taxes: taxes.lines as never,
          taxUsdCents: taxes.totalUsdCents,
          pickupLabel: input.pickup?.label ?? null,
          pickupLat: input.pickup?.lat ?? null,
          pickupLng: input.pickup?.lng ?? null,
          dropoffLabel: input.dropoff?.label ?? null,
          dropoffLat: input.dropoff?.lat ?? null,
          dropoffLng: input.dropoff?.lng ?? null,
          departureId: tourDepartureId,
        });
      } catch (bookingError) {
        // A concurrent request with the same idempotency key won the insert
        // race — return its booking instead of creating a duplicate. The
        // failed insert wrote no row, so there is nothing to roll back.
        if (idempotencyKey) {
          const prior = await findBookingByIdempotencyKey(idempotencyKey);
          if (prior) return prior;
        }
        throw bookingError;
      }

      // 2. BookingItem
      if (packageRecord) {
        const itemId = crypto.randomUUID();
        let itemTotal = subtotalUsdCents;
        await db.orm.public.BookingItem.create({
          id: itemId,
          bookingId,
          productId: product.id,
          packageId: packageRecord.id,
          label: (await db.orm.public.Product.select("title").where((f) => f.id.eq(product.id)).limit(1).all())[0]?.title ?? "",
          packageLabel: packageRecord.label,
          unitKind: packageRecord.unitKind,
          adultCount: input.adult,
          childCount: input.child,
          infantCount: input.infant,
          unitUsdCents: packageRecord.unitKind === "per_pax"
            ? (packageRecord.adultUsdCents ?? 0)
            : (packageRecord.unitUsdCents ?? 0),
          totalUsdCents: itemTotal,
        });

        // The number of days is stored separately — the column is written
        // after the insert so a database that has not been migrated yet still
        // accepts the booking.
        if (packageRecord.unitKind === "per_day") {
          try {
            await db.orm.public.BookingItem
              .where((f) => f.id.eq(itemId))
              .update({ quantity: days } as never);
          } catch (error) {
            console.error("[booking] could not store the rental days", error);
          }
          // The per-line reservation count — the stock aggregate sums it per
          // item. Written separately so an unmigrated database still stores
          // the days above; the column default (1) is already correct when
          // only one unit is reserved.
          if (vehicleCount > 1) {
            try {
              await db.orm.public.BookingItem
                .where((f) => f.id.eq(itemId))
                .update({ vehicleCount } as never);
            } catch (error) {
              console.error("[booking] could not store the item vehicle count", error);
            }
          }
        }
      }

      // 3. BookingAddOn*
      for (const addOnInput of input.addOns) {
        const addOnRec = addOnRecords.find((r) => r.slug === addOnInput.slug);
        if (addOnRec) {
          const addOnId = crypto.randomUUID();
          await db.orm.public.BookingAddOn.create({
            id: addOnId,
            bookingId,
            addOnProductId: addOnRec.id,
            label: addOnRec.label,
            quantity: addOnInput.qty,
            unitUsdCents: addOnRec.unitUsdCents ?? 0,
            totalUsdCents: (addOnRec.unitUsdCents ?? 0) * addOnInput.qty,
          });
        }
      }

      // 4. Contact (normalize: trim names, lowercase+trim email for case-insensitive lookup)
      const contactId = crypto.randomUUID();
      // The renter identity (car rental) is optional server-side — only the
      // rental UI requires it, so we persist whatever was sent. An idType
      // outside the known set is ignored rather than stored.
      const rawIdType = input.contact.idType;
      const idType =
        rawIdType === "ktp" || rawIdType === "ssn" || rawIdType === "passport"
          ? rawIdType
          : null;
      await db.orm.public.Contact.create({
        id: contactId,
        bookingId,
        firstName: input.contact.firstName.trim(),
        lastName: input.contact.lastName.trim(),
        email: input.contact.email.trim().toLowerCase(),
        phoneCountryCode: input.contact.phoneCountryCode,
        phone: input.contact.phone,
        isGuestSelf: input.contact.isGuestSelf,
        notes: input.contact.notes ?? null,
        identityNumber: input.contact.identityNumber?.trim() || null,
        idType,
        idDocumentUrl: input.contact.idDocumentUrl || null,
        signatureUrl: input.contact.signatureUrl || null,
        nationality: input.contact.nationality?.trim() || null,
      });

      // 5. Traveler* (normalize names). The passport fields are optional —
      // only the airport VIP flow sends them. docStatus starts at "received"
      // once both the passport number and the photo are in, else "pending".
      for (let i = 0; i < travelers.length; i++) {
        const traveler = travelers[i];
        if (traveler) {
          const travelerId = crypto.randomUUID();
          const passportNumber = traveler.passportNumber?.trim() || null;
          const passportPhotoKey = traveler.passportPhotoKey || null;
          await db.orm.public.Traveler.create({
            id: travelerId,
            bookingId,
            fullName: traveler.fullName.trim(),
            kind: traveler.kind,
            sortOrder: i,
            passportNumber,
            nationality:
              traveler.nationality?.trim() ||
              input.contact.nationality?.trim() ||
              null,
            dateOfBirth: traveler.dateOfBirth
              ? new Date(traveler.dateOfBirth)
              : null,
            passportExpiry: traveler.passportExpiry
              ? new Date(traveler.passportExpiry)
              : null,
            passportPhotoKey,
            docStatus: passportNumber && passportPhotoKey ? "received" : "pending",
          });
        }
      }

      // 5b. VOA handling add-on → one visa application for the lead traveler.
      // The ops team works it through the e-VOA back office; the booking pays
      // for it as a normal add-on line.
      const voaAddOn = addOnRecords.find((r) => r.slug === "voa-handling");
      if (voaAddOn) {
        const voaInput = input.addOns.find((a) => a.slug === "voa-handling");
        const lead = travelers[0];
        const visaCode = await generateUniqueVisaCode();
        if (!visaCode) {
          throw new Error("Could not generate a visa application code");
        }
        await db.orm.public.VisaApplication.create({
          id: crypto.randomUUID(),
          code: visaCode,
          bookingId,
          userId: userSession?.uid ?? null,
          productId: voaAddOn.id,
          fullName: lead?.fullName.trim() || input.contact.firstName.trim(),
          passportNumber: lead?.passportNumber?.trim() || null,
          nationality:
            lead?.nationality?.trim() ||
            input.contact.nationality?.trim() ||
            null,
          dateOfBirth: lead?.dateOfBirth ? new Date(lead.dateOfBirth) : null,
          arrivalDate: serviceAt,
          email: input.contact.email.trim().toLowerCase(),
          phone: input.contact.phone,
          contactName: input.contact.firstName.trim(),
          flightNumber: input.flight.flightCode?.trim().toUpperCase() || null,
          portOfEntryName: input.flight.airportName ?? null,
          status: "submitted",
          totalUsdCents: (voaAddOn.unitUsdCents ?? 0) * (voaInput?.qty ?? 1),
        });
      }

      // 6. FlightDetails
      const flightId = crypto.randomUUID();
      await db.orm.public.FlightDetails.create({
        id: flightId,
        bookingId,
        airportName: input.flight.airportName ?? null,
        location: input.flight.location ?? null,
        airline: input.flight.airline ?? null,
        flightCode: input.flight.flightCode ?? null,
        direction: input.flight.direction ?? null,
      });

      // 7. Payment (pending, methodId null)
      const paymentId = crypto.randomUUID();
      await db.orm.public.Payment.create({
        id: paymentId,
        bookingId,
        methodId: null,
        status: "pending",
        amountUsdCents: totalUsdCents,
      });

      // 8. The rental extras — the pickup policy, the driver option, the
      // customer's note and the tour hotel name. They are written after the
      // insert so a database that has not been migrated yet still accepts
      // the booking.
      try {
        const patch: Record<string, unknown> = {};
        if (input.notes) patch.notes = input.notes;
        if (input.pickupPolicy) patch.pickupPolicy = input.pickupPolicy;
        if (input.driverOption) patch.driverOption = input.driverOption;
        const hotelName =
          typeof input.hotelName === "string"
            ? input.hotelName.trim().slice(0, 200)
            : "";
        if (hotelName) patch.hotelName = hotelName;
        if (Object.keys(patch).length > 0) {
          await db.orm.public.Booking
            .where((f) => f.id.eq(bookingId))
            .update(patch as never);
        }
        if (input.contact.title) {
          await db.orm.public.Contact
            .where((f) => f.id.eq(contactId))
            .update({ title: input.contact.title } as never);
        }
      } catch (extraError) {
        console.error("[booking] could not store the booking extras", extraError);
      }

      // 9. Count the promo usage
      if (appliedPromoId) {
        try {
          await markPromoUsed(appliedPromoId);
        } catch (usageError) {
          console.error("[booking] could not count promo usage", usageError);
        }
      }

      return { ok: true, code, totalUsdCents, invoiceNumber };
    } catch (insertError) {
      // Compensating deletes
      console.error("[booking] insert failed, rolling back", insertError);
      try {
        await db.orm.public.VisaApplication.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.Payment.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.FlightDetails.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.Traveler.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.Contact.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.BookingAddOn.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.BookingItem.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.Booking.where((f) => f.id.eq(bookingId)).deleteAll();
      } catch (rollbackError) {
        console.error("[booking] rollback failed", rollbackError);
      }
      return { ok: false, error: "Failed to create booking. Please try again." };
    }
  } catch (error) {
    console.error("[booking] could not create booking", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, error: message };
  }
}

/**
 * Check a promo code without booking anything.
 *
 * Used by the payment step so the customer sees the discount (and any
 * problem with the code) before they confirm.
 */
export async function validatePromoCode(
  code: string,
  subtotalUsdCents: number,
): Promise<
  | { ok: true; code: string; title: string; discountUsdCents: number }
  | { ok: false; error: string }
> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "Kode promo wajib diisi." };

  const session = await getUserSession();
  const check = await checkPromo(
    trimmed,
    subtotalUsdCents,
    new Date(),
    session?.uid ?? null,
  );
  if (!check.ok) return { ok: false, error: check.error };

  return {
    ok: true,
    code: check.promo.code,
    title: check.promo.title,
    discountUsdCents: check.discountUsdCents,
  };
}

/**
 * Lookup a booking by code + email.
 * Returns discriminated result: found with booking, or not found/error.
 */
export async function getBookingByCode(
  code: string,
  email: string
): Promise<BookingLookupResult> {
  try {
    // Find booking by code
    const bookings = await db.orm.public.Booking
      .select(
        "id",
        "code",
        "status",
        "opsStatus",
        "greeterName",
        "greeterPhone",
        "serviceAt",
        "adultCount",
        "childCount",
        "infantCount",
        "subtotalUsdCents",
        "addOnsUsdCents",
        "totalUsdCents",
        "createdAt"
      )
      .where((f) => f.code.eq(code))
      .limit(1)
      .all();

    const booking = bookings[0];
    if (!booking) return { found: false, reason: "not_found" };

    // Verify contact email matches
    const contacts = await db.orm.public.Contact
      .select("bookingId", "firstName", "lastName", "email", "phoneCountryCode", "phone", "nationality")
      .where((f) => f.bookingId.eq(booking.id))
      .limit(1)
      .all();

    const contact = contacts[0];
    // Case-insensitive + whitespace-tolerant comparison on both sides.
    if (
      !contact ||
      contact.email.trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      return { found: false, reason: "not_found" };
    }

    // Get items
    const items = await db.orm.public.BookingItem
      .select("label", "packageLabel", "unitKind", "adultCount", "childCount", "infantCount", "unitUsdCents", "totalUsdCents")
      .where((f) => f.bookingId.eq(booking.id))
      .all();

    // Get add-ons
    const addOns = await db.orm.public.BookingAddOn
      .select("label", "quantity", "unitUsdCents", "totalUsdCents")
      .where((f) => f.bookingId.eq(booking.id))
      .all();

    // Get travelers (with the passport data of the airport VIP flow)
    const travelers = await db.orm.public.Traveler
      .select(
        "fullName",
        "kind",
        "passportNumber",
        "nationality",
        "dateOfBirth",
        "passportExpiry",
        "passportPhotoKey",
        "docStatus",
      )
      .where((f) => f.bookingId.eq(booking.id))
      .orderBy((f) => f.sortOrder.asc())
      .all();

    return {
      found: true,
      booking: {
        code: booking.code,
        status: booking.status,
        opsStatus: booking.opsStatus,
        greeterName: booking.greeterName ?? null,
        greeterPhone: booking.greeterPhone ?? null,
        serviceAt: new Date(booking.serviceAt).toISOString(),
        adultCount: booking.adultCount,
        childCount: booking.childCount,
        infantCount: booking.infantCount,
        subtotalUsd: (booking.subtotalUsdCents ?? 0) / 100,
        addOnsUsd: (booking.addOnsUsdCents ?? 0) / 100,
        totalUsd: (booking.totalUsdCents ?? 0) / 100,
        items: items.map((item) => ({
          label: item.label,
          packageLabel: item.packageLabel ?? undefined,
          unitKind: item.unitKind,
          adultCount: item.adultCount,
          childCount: item.childCount,
          infantCount: item.infantCount,
          unitUsd: (item.unitUsdCents ?? 0) / 100,
          totalUsd: (item.totalUsdCents ?? 0) / 100,
        })),
        addOns: addOns.map((a) => ({
          label: a.label,
          quantity: a.quantity,
          unitUsd: (a.unitUsdCents ?? 0) / 100,
          totalUsd: (a.totalUsdCents ?? 0) / 100,
        })),
        contact: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phoneCountryCode: contact.phoneCountryCode,
          phone: contact.phone,
          nationality: contact.nationality ?? null,
        },
        travelers: travelers.map((t) => ({
          fullName: t.fullName,
          kind: t.kind,
          passportNumber: t.passportNumber ?? null,
          nationality: t.nationality ?? null,
          dateOfBirth: t.dateOfBirth
            ? new Date(t.dateOfBirth).toISOString()
            : null,
          passportExpiry: t.passportExpiry
            ? new Date(t.passportExpiry).toISOString()
            : null,
          passportPhotoKey: t.passportPhotoKey ?? null,
          docStatus: t.docStatus,
        })),
        createdAt: new Date(booking.createdAt).toISOString(),
      },
    };
  } catch (error) {
    console.error("[booking] could not lookup booking", error);
    return { found: false, reason: "error" };
  }
}

export type MyBookingDTO = {
  code: string;
  status: string;
  serviceAt: string;
  totalUsdCents: number;
  adultCount: number;
  childCount: number;
  infantCount: number;
};

/**
 * List the bookings of the signed-in customer.
 *
 * Returns an empty list for guests — the guest lookup by code + email keeps
 * working exactly as before.
 */
export async function listMyBookings(): Promise<MyBookingDTO[]> {
  const session = await getUserSession();
  if (!session) return [];

  try {
    const rows = await db.orm.public.Booking
      .select(
        "code",
        "status",
        "serviceAt",
        "totalUsdCents",
        "adultCount",
        "childCount",
        "infantCount",
      )
      .where((f) => f.userId.eq(session.uid))
      .orderBy((f) => f.createdAt.desc())
      .all();

    return rows.map((row) => ({
      code: row.code,
      status: row.status,
      serviceAt: new Date(row.serviceAt).toISOString(),
      totalUsdCents: row.totalUsdCents,
      adultCount: row.adultCount,
      childCount: row.childCount,
      infantCount: row.infantCount,
    }));
  } catch (error) {
    console.error("[booking] could not list customer bookings", error);
    return [];
  }
}

/** The tour e-voucher view of a booking (`/voucher/[code]`). */
export type TourVoucherDTO = {
  code: string;
  status: string;
  serviceAt: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  totalUsdCents: number;
  invoiceNumber: string | null;
  hotelName: string | null;
  pickupLabel: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  /** The booked product (first booking item). */
  tourTitle: string;
  tourTitleId: string | null;
  packageLabel: string | null;
  productSlug: string | null;
  /** "private" | "join_in" | null (non-tour). */
  tourKind: string | null;
  durationDays: number;
  /** The join-in departure — null for private tours / non-tours. */
  departure: { date: string; startTime: string } | null;
  /** Only present when the booking is confirmed AND a driver is assigned. */
  driver: { name: string; phone: string } | null;
  vehicle: { name: string; plateNumber: string | null } | null;
  itinerary: TourItineraryDay[];
  /** The latest payment row's status ("pending" when there is none). */
  paymentStatus: string;
  contactName: string;
  createdAt: string;
};

export type TourVoucherResult =
  | { ok: true; voucher: TourVoucherDTO }
  | { ok: false; error: string };

/**
 * Lookup the tour e-voucher of a booking.
 *
 * Access: the signed-in owner (Booking.userId matches the session) needs no
 * email; everyone else proves ownership with the contact email — the same
 * rule the booking lookup and the payment flow use. The driver's contact is
 * only exposed once the booking is confirmed and a driver is assigned.
 */
export async function getTourVoucher(
  code: string,
  email: string
): Promise<TourVoucherResult> {
  try {
    const normalizedCode = code.trim().toUpperCase();
    const normalizedEmail = email.trim().toLowerCase();

    // The tour columns are new — fall back to the base columns so an
    // unmigrated database still serves the voucher (without the extras).
    let booking:
      | {
          id: string;
          code: string;
          status: string;
          serviceAt: Date;
          adultCount: number;
          childCount: number;
          infantCount: number;
          totalUsdCents: number;
          invoiceNumber: string | null;
          userId: string | null;
          createdAt: Date;
          hotelName?: string | null;
          pickupLabel?: string | null;
          pickupLat?: number | null;
          pickupLng?: number | null;
          departureId?: string | null;
          driverId?: string | null;
          vehicleId?: string | null;
        }
      | undefined;
    try {
      booking = (
        await db.orm.public.Booking
          .select(
            "id",
            "code",
            "status",
            "serviceAt",
            "adultCount",
            "childCount",
            "infantCount",
            "totalUsdCents",
            "invoiceNumber",
            "userId",
            "createdAt",
            "hotelName",
            "pickupLabel",
            "pickupLat",
            "pickupLng",
            "departureId",
            "driverId",
            "vehicleId",
          )
          .where((f) => f.code.eq(normalizedCode))
          .limit(1)
          .all()
      )[0];
    } catch {
      booking = (
        await db.orm.public.Booking
          .select(
            "id",
            "code",
            "status",
            "serviceAt",
            "adultCount",
            "childCount",
            "infantCount",
            "totalUsdCents",
            "invoiceNumber",
            "userId",
            "createdAt",
          )
          .where((f) => f.code.eq(normalizedCode))
          .limit(1)
          .all()
      )[0];
    }

    if (!booking) return { ok: false, error: "Voucher tidak ditemukan." };

    // Ownership — the signed-in owner, or the contact email for guests.
    const session = await getUserSession();
    const isOwner = !!session && booking.userId === session.uid;

    const contacts = await db.orm.public.Contact
      .select("firstName", "lastName", "email")
      .where((f) => f.bookingId.eq(booking.id))
      .limit(1)
      .all();
    const contact = contacts[0];
    if (
      !isOwner &&
      (!contact ||
        !normalizedEmail ||
        contact.email.trim().toLowerCase() !== normalizedEmail)
    ) {
      return { ok: false, error: "Voucher tidak ditemukan." };
    }

    // The booked product + package (the first item of the booking).
    const items = await db.orm.public.BookingItem
      .select("label", "packageLabel", "productId")
      .where((f) => f.bookingId.eq(booking.id))
      .limit(1)
      .all();
    const item = items[0];

    let tourTitle = item?.label ?? "";
    let tourTitleId: string | null = null;
    let productSlug: string | null = null;
    let tourKind: string | null = null;
    let durationDays = 0;
    let itinerary: TourItineraryDay[] = [];
    if (item?.productId) {
      try {
        const products = await db.orm.public.Product
          .select("slug", "title", "titleId", "tourKind", "durationDays", "itinerary")
          .where((f) => f.id.eq(item.productId))
          .limit(1)
          .all();
        const product = products[0];
        if (product) {
          tourTitle = product.title || tourTitle;
          tourTitleId = product.titleId ?? null;
          productSlug = product.slug;
          tourKind =
            product.tourKind === "private" || product.tourKind === "join_in"
              ? product.tourKind
              : null;
          durationDays = product.durationDays ?? 0;
          const raw = product.itinerary;
          if (Array.isArray(raw)) itinerary = raw as TourItineraryDay[];
        }
      } catch (error) {
        console.error("[booking] could not load the voucher product", error);
      }
    }

    // The join-in departure (date + start time).
    let departure: TourVoucherDTO["departure"] = null;
    if (booking.departureId) {
      try {
        const departures = await db.orm.public.TourDeparture
          .select("date", "startTime")
          .where((f) => f.id.eq(booking.departureId!))
          .limit(1)
          .all();
        const row = departures[0];
        if (row) {
          departure = {
            date: new Date(row.date).toISOString(),
            startTime: row.startTime,
          };
        }
      } catch (error) {
        console.error("[booking] could not load the voucher departure", error);
      }
    }

    // The driver — only once confirmed AND assigned (never before payment).
    let driver: TourVoucherDTO["driver"] = null;
    if (booking.status === "confirmed" && booking.driverId) {
      try {
        const drivers = await db.orm.public.Driver
          .select("name", "phone")
          .where((f) => f.id.eq(booking.driverId!))
          .limit(1)
          .all();
        const row = drivers[0];
        if (row) driver = { name: row.name, phone: row.phone };
      } catch (error) {
        console.error("[booking] could not load the voucher driver", error);
      }
    }

    // The assigned vehicle.
    let vehicle: TourVoucherDTO["vehicle"] = null;
    if (booking.vehicleId) {
      try {
        const vehicles = await db.orm.public.Vehicle
          .select("name", "plateNumber")
          .where((f) => f.id.eq(booking.vehicleId!))
          .limit(1)
          .all();
        const row = vehicles[0];
        if (row) vehicle = { name: row.name, plateNumber: row.plateNumber ?? null };
      } catch (error) {
        console.error("[booking] could not load the voucher vehicle", error);
      }
    }

    // The latest payment status.
    let paymentStatus = "pending";
    try {
      const payments = await db.orm.public.Payment
        .select("status")
        .where((f) => f.bookingId.eq(booking.id))
        .orderBy((f) => f.createdAt.desc())
        .limit(1)
        .all();
      paymentStatus = payments[0]?.status ?? "pending";
    } catch (error) {
      console.error("[booking] could not load the voucher payment", error);
    }

    return {
      ok: true,
      voucher: {
        code: booking.code,
        status: booking.status,
        serviceAt: new Date(booking.serviceAt).toISOString(),
        adultCount: booking.adultCount,
        childCount: booking.childCount,
        infantCount: booking.infantCount,
        totalUsdCents: booking.totalUsdCents,
        invoiceNumber: booking.invoiceNumber ?? null,
        hotelName: booking.hotelName ?? null,
        pickupLabel: booking.pickupLabel ?? null,
        pickupLat: booking.pickupLat ?? null,
        pickupLng: booking.pickupLng ?? null,
        tourTitle,
        tourTitleId,
        packageLabel: item?.packageLabel ?? null,
        productSlug,
        tourKind,
        durationDays,
        departure,
        driver,
        vehicle,
        itinerary,
        paymentStatus,
        contactName: contact
          ? `${contact.firstName} ${contact.lastName}`.trim()
          : "",
        createdAt: new Date(booking.createdAt).toISOString(),
      },
    };
  } catch (error) {
    console.error("[booking] could not lookup voucher", error);
    return { ok: false, error: "Voucher tidak bisa dimuat. Coba lagi sebentar." };
  }
}

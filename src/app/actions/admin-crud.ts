"use server";

import { db } from "@/prisma/db";
import { getAdminSession } from "@/lib/admin/session";
import { PLACE_KINDS, type PlaceKind } from "@/lib/places";
import type { TourItineraryDay } from "@/types/tour";
import {
  setProductAddOns,
  setProductAmenities,
  upsertAirport,
  upsertAmenity,
  upsertPackage,
  upsertPriceTier,
  upsertProduct,
  upsertPromoCode,
  upsertServiceLine,
  upsertServiceType,
} from "./admin";
import {
  upsertDriver,
  upsertTourDeparture,
  upsertVehicle,
} from "./admin-tour";

/**
 * The admin create / update / delete layer.
 *
 * The rules the whole admin area follows:
 *
 *   - **Create and update never happen in a modal.** The form pages call
 *     `saveAdminEntity()` — one action for every catalog table — and the
 *     answer is a structured result, so a validation failure can be shown on
 *     the field that caused it.
 *   - **Deleting always asks for the exact name.** `deleteAdminEntity()`
 *     compares the typed name with the stored name character for character
 *     (no trimming, no case folding) before it removes anything, and it
 *     refuses to delete a record that other rows still depend on.
 *
 * The upsert helpers live in `./admin`; this module only adds the form-shaped
 * contract (structured results, friendly messages, dependency checks).
 */

export type AdminEntityTable =
  | "product"
  | "package"
  | "serviceType"
  | "priceTier"
  | "place"
  | "serviceLine"
  | "amenity"
  | "promoCode"
  | "driver"
  | "vehicle"
  | "tourDeparture";

export type AdminSaveResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: string };

export type AdminDeleteResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const LABELS: Record<AdminEntityTable, string> = {
  product: "Produk",
  package: "Paket",
  serviceType: "Tipe layanan",
  priceTier: "Price tier",
  place: "Place",
  serviceLine: "Service line",
  amenity: "Amenity",
  promoCode: "Promo",
  driver: "Driver",
  vehicle: "Kendaraan",
  tourDeparture: "Jadwal keberangkatan",
};

/**
 * The admin gate.
 *
 * Mirrors `assertAdmin()` in `./admin` — it is repeated here on purpose so
 * the "use server" module does not have to export its internals.
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

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value);
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

/**
 * A string list that falls back to the English column when empty — the
 * bilingual Json? lists (includedId, …) store null, never an empty array.
 */
function asOptionalStringArray(value: unknown): string[] | null {
  if (value == null) return null;
  const list = asStringArray(value);
  return list.length > 0 ? list : null;
}

/** Parse a free-form key/value list — [{ key, name, excluded? }]. */
function asKeyValueArray(
  value: unknown,
): { key: string; name: string; excluded?: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item),
    )
    .map((item) => ({
      key: typeof item.key === "string" ? item.key.trim() : "",
      name: typeof item.name === "string" ? item.name.trim() : "",
      excluded: item.excluded === true,
    }))
    .filter((entry) => entry.key !== "" && entry.name !== "");
}

/** Parse a `datetime-local` (or ISO) input into a Date — null when empty. */
function parseDateInput(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fail(field: string, error: string): AdminSaveResult {
  return { ok: false, error, field };
}

/**
 * Turn an upsert error into a field-aware message.
 *
 * The upsert helpers throw plain errors ("slug already used",
 * "title is required"); this maps them onto the form so the operator sees
 * the problem on the field itself.
 */
function explainError(message: string): { error: string; field?: string } {
  const required = /^(\w+) is required$/.exec(message);
  if (required) {
    return { field: required[1], error: "Wajib diisi." };
  }

  const lower = message.toLowerCase();
  if (lower.includes("kind must be one of")) {
    return { field: "kind", error: "Jenis place tidak valid." };
  }
  if (lower.includes("level must be one of")) {
    return { field: "level", error: "Level wilayah tidak valid." };
  }
  if (lower.includes("slug")) return { field: "slug", error: "Slug sudah dipakai data lain." };
  if (lower.includes("iata")) return { field: "iataCode", error: "Kode IATA sudah dipakai place lain." };
  if (lower.includes("label")) return { field: "label", error: "Label sudah dipakai data lain." };
  if (lower.includes("code already used")) {
    return { field: "code", error: "Kode promo sudah dipakai promo lain." };
  }
  if (lower.includes("line not found")) return { field: "lineId", error: "Service line tidak ditemukan." };
  if (lower.includes("product not found")) return { field: "productId", error: "Produk tidak ditemukan." };
  if (lower.includes("parent place not found")) {
    return { field: "parentId", error: "Parent place tidak ditemukan." };
  }
  if (lower.includes("parent")) {
    return { field: "parentId", error: "Parent place tidak valid." };
  }
  if (lower.includes("unitkind")) {
    return { field: "unitKind", error: "Jenis unit harus Per Pax atau Per Unit." };
  }
  if (lower.includes("rating")) {
    return { field: "rating", error: "Rating harus di antara 0 dan 5." };
  }
  if (lower.includes("direction")) {
    return { field: "direction", error: "Arah harus Arrival, Departure atau Both." };
  }
  if (lower.includes("stocktotal")) {
    return { field: "stockTotal", error: "Stok total harus bilangan bulat ≥ 0." };
  }
  if (lower.includes("tourkind")) {
    return { field: "tourKind", error: "Jenis tour harus Private atau Join-in." };
  }
  if (lower.includes("durationdays")) {
    return { field: "durationDays", error: "Durasi (hari) harus bilangan bulat ≥ 0." };
  }
  if (lower.includes("maxpax")) {
    return { field: "maxPax", error: "Maks pax harus ≥ min pax (atau dikosongkan)." };
  }
  if (lower.includes("minpax")) {
    return { field: "minPax", error: "Min pax harus bilangan bulat ≥ 1." };
  }
  if (lower.includes("destination")) {
    return { field: "destinationId", error: "Place destinasi tidak ditemukan." };
  }

  return { error: message };
}

// ---------------------------------------------------------------------------
// Save — create or update one catalog row
// ---------------------------------------------------------------------------

/**
 * Create or update a catalog row.
 *
 * `id` is absent for a create and present for an update; the same action
 * serves both so the two form pages behave identically.
 */
export async function saveAdminEntity(input: {
  table: AdminEntityTable;
  id?: string;
  values: Record<string, unknown>;
}): Promise<AdminSaveResult> {
  await assertAdmin();

  const { table, values } = input;
  const id = input.id;

  try {
    switch (table) {
      case "product": {
        const title = asString(values.title);
        const slug = asString(values.slug);
        const lineId = asString(values.lineId);

        if (!title) return fail("title", "Judul wajib diisi.");
        if (!slug) return fail("slug", "Slug wajib diisi.");
        if (!lineId) return fail("lineId", "Service line wajib dipilih.");

        const rating = asNumber(values.rating);
        if (rating != null && (rating < 0 || rating > 5)) {
          return fail("rating", "Rating harus di antara 0 dan 5.");
        }

        const result = await upsertProduct({
          id,
          slug,
          lineId,
          serviceTypeId: asOptionalString(values.serviceTypeId),
          airportId: asOptionalString(values.airportId),
          title,
          description: asString(values.description),
          direction: (asString(values.direction) || "both") as
            | "arrival"
            | "departure"
            | "both",
          leadTimeHours: asNumber(values.leadTimeHours) ?? 0,
          leadTimeDays: asNumber(values.leadTimeDays) ?? 0,
          included: asStringArray(values.included),
          notIncluded: asStringArray(values.notIncluded),
          requirements: asStringArray(values.requirements),
          isAddOn: asBoolean(values.isAddOn),
          imageUrl: asOptionalString(values.imageUrl),
          tone: asString(values.tone) || "from-sky-400 to-blue-600",
          ribbon: asOptionalString(values.ribbon),
          rating,
          reviews: asNumber(values.reviews),
          durationLabel: asOptionalString(values.durationLabel),
          fromPriceUsdCents: asNumber(values.fromPriceUsdCents),
          specs: asKeyValueArray(values.specs),
          stockTotal: asNumber(values.stockTotal) ?? undefined,
          tourKind: (asString(values.tourKind) || null) as "private" | "join_in" | null,
          durationDays: asNumber(values.durationDays) ?? 0,
          minPax: asNumber(values.minPax) ?? 1,
          maxPax: asNumber(values.maxPax),
          destinationId: asOptionalString(values.destinationId),
          itinerary: values.itinerary as TourItineraryDay[],
          titleId: asOptionalString(values.titleId),
          descriptionId: asOptionalString(values.descriptionId),
          durationLabelId: asOptionalString(values.durationLabelId),
          ribbonId: asOptionalString(values.ribbonId),
          includedId: asOptionalStringArray(values.includedId),
          notIncludedId: asOptionalStringArray(values.notIncludedId),
          requirementsId: asOptionalStringArray(values.requirementsId),
          active: asBoolean(values.active),
        });

        // The join tables are written separately.
        await setProductAmenities({
          productId: result.id,
          amenityIds: asStringArray(values.amenityIds),
        });
        await setProductAddOns({
          productId: result.id,
          addOnIds: asStringArray(values.addOnIds),
        });

        return { ok: true, message: `Produk berhasil disimpan.` };
      }

      case "package": {
        const label = asString(values.label);
        const productId = asString(values.productId);
        const rawKind = asString(values.unitKind);
        const unitKind =
          rawKind === "per_unit" ? "per_unit" : rawKind === "per_day" ? "per_day" : "per_pax";

        if (!label) return fail("label", "Label wajib diisi.");
        if (!productId) return fail("productId", "Produk wajib dipilih.");

        await upsertPackage({
          id,
          productId,
          label,
          unitKind,
          adultUsdCents: asNumber(values.adultUsdCents),
          childUsdCents: asNumber(values.childUsdCents),
          infantUsdCents: asNumber(values.infantUsdCents),
          unitUsdCents: asNumber(values.unitUsdCents),
          durationHours: asNumber(values.durationHours),
          extraHourUsdCents: asNumber(values.extraHourUsdCents),
          fromUsdCents: asNumber(values.fromUsdCents),
          description: asOptionalString(values.description),
          descriptionId: asOptionalString(values.descriptionId),
          info: asKeyValueArray(values.info),
          sortOrder: asNumber(values.sortOrder) ?? 0,
          active: asBoolean(values.active),
        });

        return { ok: true, message: `Paket berhasil disimpan.` };
      }

      case "serviceType": {
        const name = asString(values.name);
        const slug = asString(values.slug);
        const lineId = asString(values.lineId);

        if (!name) return fail("name", "Nama wajib diisi.");
        if (!slug) return fail("slug", "Slug wajib diisi.");
        if (!lineId) return fail("lineId", "Service line wajib dipilih.");

        await upsertServiceType({
          id,
          lineId,
          slug,
          name,
          sortOrder: asNumber(values.sortOrder) ?? 0,
          active: asBoolean(values.active),
        });

        return { ok: true, message: `Tipe layanan berhasil disimpan.` };
      }

      case "priceTier": {
        const label = asString(values.label);
        if (!label) return fail("label", "Label wajib diisi.");

        const maxUsdCents = asNumber(values.maxUsdCents) ?? 0;
        if (maxUsdCents < 0) return fail("maxUsdCents", "Batas maksimum tidak boleh negatif.");

        await upsertPriceTier({
          id,
          lineId: asOptionalString(values.lineId),
          label,
          maxUsdCents,
          sortOrder: asNumber(values.sortOrder) ?? 0,
          active: asBoolean(values.active),
        });

        return { ok: true, message: `Price tier berhasil disimpan.` };
      }

      case "place": {
        const name = asString(values.name);
        const city = asString(values.city);

        if (!name) return fail("name", "Nama wajib diisi.");
        if (!city) return fail("city", "Kota wajib diisi.");

        const rawKind = asString(values.kind);
        const kind: PlaceKind = (PLACE_KINDS as readonly string[]).includes(rawKind)
          ? (rawKind as PlaceKind)
          : "airport";
        const rawLevel = asString(values.level);
        const level = (PLACE_KINDS as readonly string[]).includes(rawLevel)
          ? (rawLevel as PlaceKind)
          : kind;

        await upsertAirport({
          id,
          kind,
          level,
          iataCode: asOptionalString(values.iataCode),
          name,
          city,
          country: asString(values.country) || "Indonesia",
          imageUrl: asOptionalString(values.imageUrl),
          active: asBoolean(values.active),
          parentId: asOptionalString(values.parentId),
          sortOrder: asNumber(values.sortOrder) ?? 0,
        });

        return { ok: true, message: `Place berhasil disimpan.` };
      }

      case "serviceLine": {
        const label = asString(values.label);
        const slug = asString(values.slug);
        const short = asString(values.short);

        if (!label) return fail("label", "Label wajib diisi.");
        if (!slug) return fail("slug", "Slug wajib diisi.");
        if (!short) return fail("short", "Short wajib diisi.");

        await upsertServiceLine({
          id,
          slug,
          label,
          short,
          badge: asOptionalString(values.badge),
          tone: asString(values.tone) || "from-sky-400 to-blue-600",
          imageUrl: asOptionalString(values.imageUrl),
          sortOrder: asNumber(values.sortOrder) ?? 0,
          active: asBoolean(values.active),
        });

        return { ok: true, message: `Service line berhasil disimpan.` };
      }

      case "amenity": {
        const label = asString(values.label);
        if (!label) return fail("label", "Label wajib diisi.");

        await upsertAmenity({ id, label });

        return { ok: true, message: `Amenity berhasil disimpan.` };
      }

      case "promoCode": {
        const code = asString(values.code);
        const title = asString(values.title);
        const type = asString(values.type) === "fixed" ? "fixed" : "percentage";

        if (!code) return fail("code", "Kode promo wajib diisi.");
        if (!title) return fail("title", "Judul promo wajib diisi.");

        // "fixed" → USD cents, "percentage" → 0-100.
        const value =
          type === "fixed"
            ? asNumber(values.valueUsdCents) ?? 0
            : asNumber(values.valuePercent) ?? 0;

        if (type === "percentage" && (value < 0 || value > 100)) {
          return fail("valuePercent", "Diskon persen harus antara 0 dan 100.");
        }

        await upsertPromoCode({
          id,
          code,
          title,
          type,
          value: Math.trunc(value),
          minTotalUsdCents: asNumber(values.minTotalUsdCents) ?? 0,
          usageLimit: asNumber(values.usageLimit),
          startsAt: parseDateInput(values.startsAt),
          endsAt: parseDateInput(values.endsAt),
          active: asBoolean(values.active),
        });

        return { ok: true, message: `Promo berhasil disimpan.` };
      }

      case "driver": {
        return await upsertDriver({
          id,
          name: asString(values.name),
          phone: asString(values.phone),
          languages: asOptionalString(values.languages),
          photoUrl: asOptionalString(values.photoUrl),
          notes: asOptionalString(values.notes),
          active: asBoolean(values.active),
          sortOrder: asNumber(values.sortOrder) ?? 0,
        });
      }

      case "vehicle": {
        return await upsertVehicle({
          id,
          name: asString(values.name),
          plateNumber: asOptionalString(values.plateNumber),
          seats: asNumber(values.seats) ?? 6,
          photoUrl: asOptionalString(values.photoUrl),
          notes: asOptionalString(values.notes),
          active: asBoolean(values.active),
          sortOrder: asNumber(values.sortOrder) ?? 0,
        });
      }

      case "tourDeparture": {
        return await upsertTourDeparture({
          id,
          productId: asString(values.productId),
          date: asString(values.date),
          startTime: asString(values.startTime) || "08:00",
          quota: asNumber(values.quota) ?? 10,
          status: asString(values.status) || "open",
          notes: asOptionalString(values.notes),
        });
      }

      default:
        return { ok: false, error: "Jenis data tidak dikenal." };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal menyimpan data";
    const explained = explainError(message);
    return { ok: false, error: explained.error, field: explained.field };
  }
}

// ---------------------------------------------------------------------------
// Delete — only after the exact name has been typed
// ---------------------------------------------------------------------------

/** The name the operator has to type to confirm the deletion. */
export async function getAdminEntityName(input: {
  table: AdminEntityTable;
  id: string;
}): Promise<string | null> {
  await assertAdmin();

  switch (input.table) {
    case "product": {
      const row = await db.orm.public.Product.select("title").where({ id: input.id }).first();
      return row?.title ?? null;
    }
    case "package": {
      const row = await db.orm.public.ProductPackage.select("label").where({ id: input.id }).first();
      return row?.label ?? null;
    }
    case "serviceType": {
      const row = await db.orm.public.ServiceType.select("name").where({ id: input.id }).first();
      return row?.name ?? null;
    }
    case "priceTier": {
      const row = await db.orm.public.PriceTier.select("label").where({ id: input.id }).first();
      return row?.label ?? null;
    }
    case "place": {
      const row = await db.orm.public.Airport.select("name").where({ id: input.id }).first();
      return row?.name ?? null;
    }
    case "serviceLine": {
      const row = await db.orm.public.ServiceLine.select("label").where({ id: input.id }).first();
      return row?.label ?? null;
    }
    case "amenity": {
      const row = await db.orm.public.Amenity.select("label").where({ id: input.id }).first();
      return row?.label ?? null;
    }
    case "promoCode": {
      const row = await db.orm.public.PromoCode.select("code").where({ id: input.id }).first();
      return row?.code ?? null;
    }
    case "driver": {
      const row = await db.orm.public.Driver.select("name").where({ id: input.id }).first();
      return row?.name ?? null;
    }
    case "vehicle": {
      const row = await db.orm.public.Vehicle.select("name").where({ id: input.id }).first();
      return row?.name ?? null;
    }
    case "tourDeparture": {
      const row = await db.orm.public.TourDeparture
        .select("productId", "date", "startTime")
        .where({ id: input.id })
        .first();
      if (!row) return null;
      const product = await db.orm.public.Product
        .select("title")
        .where({ id: row.productId })
        .first();
      // The same label the list shows — product · ISO day · start time.
      return `${product?.title ?? "Produk"} · ${new Date(row.date).toISOString().slice(0, 10)} ${row.startTime}`;
    }
    default:
      return null;
  }
}

/**
 * Delete a catalog row — but only when the operator typed its exact name.
 *
 * The comparison is strict: the typed text has to be character-for-character
 * identical to the stored name. Nothing is trimmed and no case is folded,
 * so the same rule applies in the browser and on the server.
 */
export async function deleteAdminEntity(input: {
  table: AdminEntityTable;
  id: string;
  /** The name the operator typed into the confirmation field. */
  confirmName: string;
}): Promise<AdminDeleteResult> {
  await assertAdmin();

  if (!input.id) {
    return { ok: false, error: "Data tidak ditemukan." };
  }

  const name = await getAdminEntityName({ table: input.table, id: input.id });
  if (name == null) {
    return { ok: false, error: "Data tidak ditemukan." };
  }

  if (input.confirmName !== name) {
    return {
      ok: false,
      error: "Nama yang diketik tidak cocok dengan nama data. Penghapusan dibatalkan.",
    };
  }

  const id = input.id;

  try {
    switch (input.table) {
      case "product": {
        const booked = await db.orm.public.BookingItem
          .where((f) => f.productId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        if (booked.n > 0) {
          return {
            ok: false,
            error: `Produk masih dipakai pada ${booked.n} booking. Hapus atau batalkan booking terkait terlebih dahulu.`,
          };
        }

        const bookedAddOns = await db.orm.public.BookingAddOn
          .where((f) => f.addOnProductId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        if (bookedAddOns.n > 0) {
          return {
            ok: false,
            error: `Produk masih dipakai sebagai add-on pada ${bookedAddOns.n} booking. Hapus atau batalkan booking terkait terlebih dahulu.`,
          };
        }

        // The join rows belong to the product and go with it.
        await db.orm.public.ProductPackage.where((f) => f.productId.eq(id)).deleteAll();
        await db.orm.public.ProductAmenity.where((f) => f.productId.eq(id)).deleteAll();
        await db.orm.public.ProductAddOn.where((f) => f.productId.eq(id)).deleteAll();
        await db.orm.public.ProductAddOn.where((f) => f.addOnId.eq(id)).deleteAll();
        await db.orm.public.Product.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "package": {
        const booked = await db.orm.public.BookingItem
          .where((f) => f.packageId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        if (booked.n > 0) {
          return {
            ok: false,
            error: `Paket masih dipakai pada ${booked.n} booking. Hapus atau batalkan booking terkait terlebih dahulu.`,
          };
        }

        await db.orm.public.ProductPackage.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "serviceType": {
        const used = await db.orm.public.Product
          .where((f) => f.serviceTypeId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        if (used.n > 0) {
          return {
            ok: false,
            error: `Tipe layanan masih dipakai oleh ${used.n} produk. Pindahkan atau hapus produknya terlebih dahulu.`,
          };
        }

        await db.orm.public.ServiceType.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "priceTier": {
        await db.orm.public.PriceTier.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "place": {
        const used = await db.orm.public.Product
          .where((f) => f.airportId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        if (used.n > 0) {
          return {
            ok: false,
            error: `Place masih dipakai oleh ${used.n} produk. Pindahkan atau hapus produknya terlebih dahulu.`,
          };
        }

        // Children become roots of the hierarchy.
        await db.orm.public.Airport.where({ parentId: id }).update({ parentId: null });
        await db.orm.public.Airport.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "serviceLine": {
        const types = await db.orm.public.ServiceType
          .where((f) => f.lineId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        const products = await db.orm.public.Product
          .where((f) => f.lineId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        const tiers = await db.orm.public.PriceTier
          .where((f) => f.lineId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        const fields = await db.orm.public.SearchField
          .where((f) => f.lineId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        const promos = await db.orm.public.Promo
          .where((f) => f.lineId.eq(id))
          .aggregate((a) => ({ n: a.count() }));

        if (types.n + products.n + tiers.n + fields.n + promos.n > 0) {
          return {
            ok: false,
            error:
              `Service line masih dipakai oleh ${types.n} tipe layanan, ${products.n} produk, ` +
              `${tiers.n} price tier, ${fields.n} search field dan ${promos.n} promo. ` +
              `Hapus atau pindahkan datanya terlebih dahulu.`,
          };
        }

        await db.orm.public.ServiceLine.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "amenity": {
        await db.orm.public.ProductAmenity.where((f) => f.amenityId.eq(id)).deleteAll();
        await db.orm.public.Amenity.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "promoCode": {
        // Bookings only store the promo *code* as text, so nothing else
        // has to be cleaned up.
        await db.orm.public.PromoCode.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "driver": {
        const used = await db.orm.public.Booking
          .where((f) => f.driverId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        if (used.n > 0) {
          return {
            ok: false,
            error: `Driver masih ditugaskan pada ${used.n} booking. Lepaskan penugasan driver pada booking terkait terlebih dahulu.`,
          };
        }

        await db.orm.public.Driver.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "vehicle": {
        const used = await db.orm.public.Booking
          .where((f) => f.vehicleId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        if (used.n > 0) {
          return {
            ok: false,
            error: `Kendaraan masih ditugaskan pada ${used.n} booking. Lepaskan penugasan kendaraan pada booking terkait terlebih dahulu.`,
          };
        }

        await db.orm.public.Vehicle.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      case "tourDeparture": {
        const used = await db.orm.public.Booking
          .where((f) => f.departureId.eq(id))
          .aggregate((a) => ({ n: a.count() }));
        if (used.n > 0) {
          return {
            ok: false,
            error: `Jadwal masih dipakai pada ${used.n} booking. Batalkan atau pindahkan booking terkait terlebih dahulu.`,
          };
        }

        await db.orm.public.TourDeparture.where((f) => f.id.eq(id)).deleteAll();
        break;
      }

      default:
        return { ok: false, error: "Jenis data tidak dikenal." };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal menghapus data";
    if (message.toLowerCase().includes("foreign key")) {
      return {
        ok: false,
        error: "Data masih dipakai oleh data lain sehingga tidak bisa dihapus.",
      };
    }
    return { ok: false, error: message };
  }

  return { ok: true, message: `${LABELS[input.table]} berhasil dihapus.` };
}

"use server";

import { db } from "@/prisma/db";
import { getAdminSession } from "@/lib/admin/session";
import { signedDocumentUrl } from "@/lib/storage";
import { fieldOrder } from "@/lib/admin/paging";
import {
  all,
  and,
  or,
  type Condition,
  type ModelAccessor,
} from "@prisma/orm-postgres/orm-client";
import type { Contract } from "@/prisma/contract.d";

/**
 * Admin back-office for Airport VIP orders & document handling.
 *
 * Separate from the catalog layer (`admin.ts` / `admin-crud.ts`): this module
 * owns the booking operations slice — the order list, the order detail with
 * traveller documents, and the ops / document / VOA status writes.
 *
 * Every function is gated by `assertAdmin()`, which requires BOTH:
 *   1. `ADMIN_ENABLED=1` in the environment — a deployment kill-switch, and
 *   2. a valid admin session cookie — the actual authorization check.
 *
 * Reads swallow database errors into empty/null results so the UI keeps
 * working when the database is unreachable; writes answer with a structured
 * result (`{ ok: true, message }` / `{ ok: false, error, field? }`) so a
 * validation failure can be shown next to the control that caused it.
 *
 * The DTOs are declared locally on purpose — the booking wizard's types are
 * owned by another workstream and must not be coupled to this module.
 */

// ---------------------------------------------------------------------------
// Status vocabularies (the DB columns are plain strings)
// ---------------------------------------------------------------------------

export type OrderPaymentStatus =
  | "awaiting_payment"
  | "confirmed"
  | "cancelled"
  | "completed";

export type OrderOpsStatus =
  | "waiting_documents"
  | "processing"
  | "ready"
  | "in_service"
  | "done";

export type TravelerDocStatus =
  | "pending"
  | "received"
  | "processing"
  | "ready"
  | "issue";

export type OrderVisaStatus = "submitted" | "processing" | "approved" | "rejected";

const PAYMENT_STATUSES: readonly string[] = [
  "awaiting_payment",
  "confirmed",
  "cancelled",
  "completed",
];

const OPS_STATUSES: readonly string[] = [
  "waiting_documents",
  "processing",
  "ready",
  "in_service",
  "done",
];

const DOC_STATUSES: readonly string[] = [
  "pending",
  "received",
  "processing",
  "ready",
  "issue",
];

const VISA_STATUSES: readonly string[] = [
  "submitted",
  "processing",
  "approved",
  "rejected",
];

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type AdminOrderRow = {
  id: string;
  code: string;
  createdAt: string;
  serviceAt: string;
  contactName: string;
  contactEmail: string;
  nationality: string | null;
  /** Airport + direction, e.g. "Soekarno-Hatta (CGK) · Kedatangan". */
  airportSummary: string;
  /** Airline + flight code, e.g. "Garuda Indonesia GA123". */
  flightSummary: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  totalUsdCents: number;
  status: string;
  opsStatus: string;
  /** Travellers whose documents are verified complete (docStatus "ready"). */
  docsReceived: number;
  docsTotal: number;
};

export type AdminOrderListResult = {
  rows: AdminOrderRow[];
  total: number;
};

export type AdminOrderContact = {
  name: string;
  email: string;
  phone: string;
  nationality: string | null;
  notes: string | null;
};

export type AdminOrderFlight = {
  airportName: string | null;
  location: string | null;
  airline: string | null;
  flightCode: string | null;
  direction: string | null;
};

export type AdminOrderItem = {
  id: string;
  label: string;
  packageLabel: string | null;
  unitKind: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  quantity: number;
  unitUsdCents: number;
  totalUsdCents: number;
};

export type AdminOrderAddOn = {
  id: string;
  label: string;
  quantity: number;
  unitUsdCents: number;
  totalUsdCents: number;
};

export type AdminOrderTraveler = {
  id: string;
  fullName: string;
  kind: string;
  sortOrder: number;
  passportNumber: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  passportExpiry: string | null;
  passportPhotoKey: string | null;
  /** Short-lived signed GET URL — null when no photo or R2 is unreachable. */
  passportPhotoUrl: string | null;
  docStatus: string;
  docNote: string | null;
};

export type AdminOrderPayment = {
  id: string;
  status: string;
  amountUsdCents: number;
  methodLabel: string | null;
  provider: string | null;
  reference: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type AdminOrderVisa = {
  id: string;
  code: string;
  status: string;
  fullName: string | null;
  passportNumber: string | null;
  nationality: string | null;
  arrivalDate: string;
  note: string | null;
  totalUsdCents: number;
  createdAt: string;
};

export type AdminOrderDetail = {
  id: string;
  code: string;
  status: string;
  opsStatus: string;
  greeterName: string | null;
  greeterPhone: string | null;
  opsNote: string | null;
  createdAt: string;
  serviceAt: string;
  invoiceNumber: string | null;
  notes: string | null;
  adultCount: number;
  childCount: number;
  infantCount: number;
  subtotalUsdCents: number;
  addOnsUsdCents: number;
  discountUsdCents: number;
  taxUsdCents: number;
  totalUsdCents: number;
  contact: AdminOrderContact | null;
  flight: AdminOrderFlight | null;
  items: AdminOrderItem[];
  addOns: AdminOrderAddOn[];
  travelers: AdminOrderTraveler[];
  /** The latest payment attempt, or null when none exists yet. */
  payment: AdminOrderPayment | null;
  visaApplications: AdminOrderVisa[];
};

export type AdminOrderMutationResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: string };

// ---------------------------------------------------------------------------
// Gate + value helpers
// ---------------------------------------------------------------------------

/**
 * The admin gate — mirrors `assertAdmin()` in `admin.ts` / `admin-crud.ts`.
 * Repeated here on purpose so this "use server" module stays self-contained.
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

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value);
  return text.length > 0 ? text : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Terjadi kesalahan";
}

const DIRECTION_LABELS: Record<string, string> = {
  arrival: "Kedatangan",
  departure: "Keberangkatan",
};

/** Direct Booking columns the airport-VIP order table may sort by. */
const ORDER_SORT_KEYS = [
  "code",
  "createdAt",
  "serviceAt",
  "status",
  "opsStatus",
  "totalUsdCents",
  "adultCount",
  "childCount",
  "infantCount",
] as const;

// ---------------------------------------------------------------------------
// listOrders
// ---------------------------------------------------------------------------

/**
 * The order list — newest first, with payment / ops filters and a search over
 * the booking code and the contact's name / email. Returns the page plus the
 * total count so the UI can paginate.
 */
export async function listOrders(input?: {
  q?: string;
  status?: string;
  opsStatus?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}): Promise<AdminOrderListResult> {
  await assertAdmin();

  const empty: AdminOrderListResult = { rows: [], total: 0 };

  const q = asString(input?.q);
  const status = asString(input?.status);
  const opsStatus = asString(input?.opsStatus);
  const limit =
    typeof input?.limit === "number" && Number.isInteger(input.limit)
      ? Math.min(Math.max(input.limit, 1), 100)
      : 5;
  const offset =
    typeof input?.offset === "number" && Number.isInteger(input.offset)
      ? Math.max(input.offset, 0)
      : 0;

  // Unknown filter values are ignored rather than failing the whole list.
  const statusFilter = PAYMENT_STATUSES.includes(status) ? status : "";
  const opsFilter = OPS_STATUSES.includes(opsStatus) ? opsStatus : "";

  // Unknown sort keys fall back to the default newest-first order.
  const sortBy =
    input?.sortBy && (ORDER_SORT_KEYS as readonly string[]).includes(input.sortBy)
      ? input.sortBy
      : null;
  const sortDir = input?.sortDir === "asc" ? "asc" : "desc";

  // One row fragment shared by the page query and the count query. Codes are
  // stored uppercase and contact emails lowercase, so those two match on the
  // normalized form; names match as typed.
  const filter = (f: ModelAccessor<Contract, "Booking", "public">): Condition =>
    and(
      statusFilter ? f.status.eq(statusFilter) : all(),
      opsFilter ? f.opsStatus.eq(opsFilter) : all(),
      q
        ? or(
            f.code.like(`%${q.toUpperCase()}%`),
            f.contact.some((c) =>
              or(
                c.firstName.like(`%${q}%`),
                c.lastName.like(`%${q}%`),
                c.email.like(`%${q.toLowerCase()}%`),
              ),
            ),
          )
        : all(),
    );

  try {
    const [count, rows] = await Promise.all([
      db.orm.public.Booking.where(filter).aggregate((a) => ({ n: a.count() })),
      db.orm.public.Booking
        .select(
          "id",
          "code",
          "createdAt",
          "serviceAt",
          "adultCount",
          "childCount",
          "infantCount",
          "totalUsdCents",
          "status",
          "opsStatus",
        )
        .include("contact", (c) =>
          c.select("firstName", "lastName", "email", "nationality"),
        )
        .include("flight", (fl) =>
          fl.select("airportName", "location", "airline", "flightCode", "direction"),
        )
        .include("travelers", (t) => t.select("docStatus"))
        .where(filter)
        .orderBy(
          sortBy
            ? ([fieldOrder(sortBy, sortDir), fieldOrder("id", "desc")] as never)
            : ([fieldOrder("createdAt", "desc"), fieldOrder("id", "desc")] as never),
        )
        .limit(limit)
        .offset(offset)
        .all(),
    ]);

    return {
      total: count.n,
      rows: rows.map((r) => {
        const contactName = r.contact
          ? `${r.contact.firstName} ${r.contact.lastName}`.trim()
          : "—";
        const airport = r.flight?.airportName ?? r.flight?.location ?? null;
        const direction = r.flight?.direction
          ? (DIRECTION_LABELS[r.flight.direction] ?? r.flight.direction)
          : null;
        const flightParts = [r.flight?.airline, r.flight?.flightCode].filter(Boolean);
        return {
          id: r.id,
          code: r.code,
          createdAt: new Date(r.createdAt).toISOString(),
          serviceAt: new Date(r.serviceAt).toISOString(),
          contactName,
          contactEmail: r.contact?.email ?? "",
          nationality: r.contact?.nationality ?? null,
          airportSummary: [airport, direction].filter(Boolean).join(" · ") || "—",
          flightSummary: flightParts.join(" ") || "—",
          adultCount: r.adultCount,
          childCount: r.childCount,
          infantCount: r.infantCount,
          totalUsdCents: r.totalUsdCents,
          status: r.status,
          opsStatus: r.opsStatus,
          docsReceived: r.travelers.filter((t) => t.docStatus === "ready").length,
          docsTotal: r.travelers.length,
        };
      }),
    };
  } catch (error) {
    console.error("[admin-orders] could not load orders", error);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// getOrderDetail
// ---------------------------------------------------------------------------

/** The full order — contact, flight, items, traveller documents, payment, VOA. */
export async function getOrderDetail(bookingId: string): Promise<AdminOrderDetail | null> {
  await assertAdmin();

  const id = asString(bookingId);
  if (!id) return null;

  try {
    const booking = await db.orm.public.Booking
      .select(
        "id",
        "code",
        "status",
        "opsStatus",
        "greeterName",
        "greeterPhone",
        "opsNote",
        "createdAt",
        "serviceAt",
        "invoiceNumber",
        "notes",
        "adultCount",
        "childCount",
        "infantCount",
        "subtotalUsdCents",
        "addOnsUsdCents",
        "discountUsdCents",
        "taxUsdCents",
        "totalUsdCents",
      )
      .include("contact", (c) =>
        c.select("title", "firstName", "lastName", "email", "phoneCountryCode", "phone", "nationality", "notes"),
      )
      .include("flight", (fl) =>
        fl.select("airportName", "location", "airline", "flightCode", "direction"),
      )
      .include("items", (it) =>
        it.select(
          "id",
          "label",
          "packageLabel",
          "unitKind",
          "adultCount",
          "childCount",
          "infantCount",
          "quantity",
          "unitUsdCents",
          "totalUsdCents",
        ),
      )
      .include("addOns", (ao) =>
        ao.select("id", "label", "quantity", "unitUsdCents", "totalUsdCents"),
      )
      .include("travelers", (t) =>
        t
          .select(
            "id",
            "fullName",
            "kind",
            "sortOrder",
            "passportNumber",
            "nationality",
            "dateOfBirth",
            "passportExpiry",
            "passportPhotoKey",
            "docStatus",
            "docNote",
          )
          .orderBy((f) => f.sortOrder.asc()),
      )
      .include("payments", (p) =>
        p
          .select("id", "status", "amountUsdCents", "provider", "reference", "paidAt", "createdAt")
          .include("method", (m) => m.select("label"))
          .orderBy((f) => f.createdAt.desc())
          .limit(1),
      )
      .include("visaApplications", (v) =>
        v
          .select(
            "id",
            "code",
            "status",
            "fullName",
            "passportNumber",
            "nationality",
            "arrivalDate",
            "note",
            "totalUsdCents",
            "createdAt",
          )
          .orderBy((f) => f.createdAt.desc()),
      )
      .where({ id })
      .first();

    if (!booking) return null;

    // Passport photos live in the private bucket — resolve each key to a
    // short-lived signed GET URL. Never build a public URL for them.
    const travelers: AdminOrderTraveler[] = await Promise.all(
      booking.travelers.map(async (t) => {
        let passportPhotoUrl: string | null = null;
        if (t.passportPhotoKey) {
          try {
            passportPhotoUrl = await signedDocumentUrl(t.passportPhotoKey, 300);
          } catch (error) {
            console.error("[admin-orders] could not sign passport photo", error);
          }
        }
        return {
          id: t.id,
          fullName: t.fullName,
          kind: t.kind,
          sortOrder: t.sortOrder,
          passportNumber: t.passportNumber,
          nationality: t.nationality,
          dateOfBirth: iso(t.dateOfBirth),
          passportExpiry: iso(t.passportExpiry),
          passportPhotoKey: t.passportPhotoKey,
          passportPhotoUrl,
          docStatus: t.docStatus,
          docNote: t.docNote,
        };
      }),
    );

    const latest = booking.payments[0] ?? null;

    return {
      id: booking.id,
      code: booking.code,
      status: booking.status,
      opsStatus: booking.opsStatus,
      greeterName: booking.greeterName,
      greeterPhone: booking.greeterPhone,
      opsNote: booking.opsNote,
      createdAt: new Date(booking.createdAt).toISOString(),
      serviceAt: new Date(booking.serviceAt).toISOString(),
      invoiceNumber: booking.invoiceNumber,
      notes: booking.notes,
      adultCount: booking.adultCount,
      childCount: booking.childCount,
      infantCount: booking.infantCount,
      subtotalUsdCents: booking.subtotalUsdCents,
      addOnsUsdCents: booking.addOnsUsdCents,
      discountUsdCents: booking.discountUsdCents,
      taxUsdCents: booking.taxUsdCents,
      totalUsdCents: booking.totalUsdCents,
      contact: booking.contact
        ? {
            name: `${booking.contact.firstName} ${booking.contact.lastName}`.trim(),
            email: booking.contact.email,
            phone: `${booking.contact.phoneCountryCode} ${booking.contact.phone}`.trim(),
            nationality: booking.contact.nationality,
            notes: booking.contact.notes,
          }
        : null,
      flight: booking.flight
        ? {
            airportName: booking.flight.airportName,
            location: booking.flight.location,
            airline: booking.flight.airline,
            flightCode: booking.flight.flightCode,
            direction: booking.flight.direction,
          }
        : null,
      items: booking.items.map((it) => ({
        id: it.id,
        label: it.label,
        packageLabel: it.packageLabel,
        unitKind: it.unitKind,
        adultCount: it.adultCount,
        childCount: it.childCount,
        infantCount: it.infantCount,
        quantity: it.quantity,
        unitUsdCents: it.unitUsdCents,
        totalUsdCents: it.totalUsdCents,
      })),
      addOns: booking.addOns.map((ao) => ({
        id: ao.id,
        label: ao.label,
        quantity: ao.quantity,
        unitUsdCents: ao.unitUsdCents,
        totalUsdCents: ao.totalUsdCents,
      })),
      travelers,
      payment: latest
        ? {
            id: latest.id,
            status: latest.status,
            amountUsdCents: latest.amountUsdCents,
            methodLabel: latest.method?.label ?? null,
            provider: latest.provider,
            reference: latest.reference,
            paidAt: iso(latest.paidAt),
            createdAt: new Date(latest.createdAt).toISOString(),
          }
        : null,
      visaApplications: booking.visaApplications.map((v) => ({
        id: v.id,
        code: v.code,
        status: v.status,
        fullName: v.fullName,
        passportNumber: v.passportNumber,
        nationality: v.nationality,
        arrivalDate: new Date(v.arrivalDate).toISOString(),
        note: v.note,
        totalUsdCents: v.totalUsdCents,
        createdAt: new Date(v.createdAt).toISOString(),
      })),
    };
  } catch (error) {
    console.error("[admin-orders] could not load order detail", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// updateOrderOps
// ---------------------------------------------------------------------------

/** Set the operational status, greeter assignment and internal ops note. */
export async function updateOrderOps(input: {
  bookingId: string;
  opsStatus: string;
  greeterName?: string;
  greeterPhone?: string;
  opsNote?: string;
}): Promise<AdminOrderMutationResult> {
  try {
    await assertAdmin();

    const bookingId = asString(input.bookingId);
    if (!bookingId) return { ok: false, error: "Booking tidak valid.", field: "bookingId" };
    if (!OPS_STATUSES.includes(input.opsStatus)) {
      return { ok: false, error: "Status operasional tidak valid.", field: "opsStatus" };
    }

    const existing = await db.orm.public.Booking
      .select("id")
      .where({ id: bookingId })
      .first();
    if (!existing) return { ok: false, error: "Booking tidak ditemukan." };

    await db.orm.public.Booking.where({ id: bookingId }).update({
      opsStatus: input.opsStatus,
      greeterName: asOptionalString(input.greeterName),
      greeterPhone: asOptionalString(input.greeterPhone),
      opsNote: asOptionalString(input.opsNote),
    });

    return { ok: true, message: "Operasional booking diperbarui." };
  } catch (error) {
    console.error("[admin-orders] could not update order ops", error);
    return { ok: false, error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// updateTravelerDoc
// ---------------------------------------------------------------------------

/** Set the document handling status and operator note of one traveller. */
export async function updateTravelerDoc(input: {
  travelerId: string;
  docStatus: string;
  docNote?: string;
}): Promise<AdminOrderMutationResult> {
  try {
    await assertAdmin();

    const travelerId = asString(input.travelerId);
    if (!travelerId) return { ok: false, error: "Penumpang tidak valid.", field: "travelerId" };
    if (!DOC_STATUSES.includes(input.docStatus)) {
      return { ok: false, error: "Status dokumen tidak valid.", field: "docStatus" };
    }

    const existing = await db.orm.public.Traveler
      .select("id")
      .where({ id: travelerId })
      .first();
    if (!existing) return { ok: false, error: "Penumpang tidak ditemukan." };

    await db.orm.public.Traveler.where({ id: travelerId }).update({
      docStatus: input.docStatus,
      docNote: asOptionalString(input.docNote),
    });

    return { ok: true, message: "Dokumen penumpang diperbarui." };
  } catch (error) {
    console.error("[admin-orders] could not update traveler document", error);
    return { ok: false, error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// updateVisaStatus
// ---------------------------------------------------------------------------

/** Set the status and note of a VOA application linked to a booking. */
export async function updateVisaStatus(input: {
  visaApplicationId: string;
  status: string;
  note?: string;
}): Promise<AdminOrderMutationResult> {
  try {
    await assertAdmin();

    const visaApplicationId = asString(input.visaApplicationId);
    if (!visaApplicationId) {
      return { ok: false, error: "Aplikasi VOA tidak valid.", field: "visaApplicationId" };
    }
    if (!VISA_STATUSES.includes(input.status)) {
      return { ok: false, error: "Status VOA tidak valid.", field: "status" };
    }

    const existing = await db.orm.public.VisaApplication
      .select("id")
      .where({ id: visaApplicationId })
      .first();
    if (!existing) return { ok: false, error: "Aplikasi VOA tidak ditemukan." };

    await db.orm.public.VisaApplication.where({ id: visaApplicationId }).update({
      status: input.status,
      note: asOptionalString(input.note),
    });

    return { ok: true, message: "Status VOA diperbarui." };
  } catch (error) {
    console.error("[admin-orders] could not update visa status", error);
    return { ok: false, error: errorMessage(error) };
  }
}
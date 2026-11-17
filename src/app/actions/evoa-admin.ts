"use server";

import { db } from "@/prisma/db";
import { getAdminSession } from "@/lib/admin/session";
import { notifyEvoaStatusChange } from "@/lib/evoa-notify";
import { and, or } from "@prisma/orm-postgres/orm-client";
import {
  EVOA_FIELD_TYPES,
  EVOA_LEGACY_STATUSES,
  EVOA_ORDER_STATUSES,
  evoaDocSlot,
  type EvoaAnswers,
  type EvoaDocumentDTO,
  type EvoaFieldOption,
  type EvoaFieldScope,
  type EvoaFieldType,
  type EvoaStatusEventDTO,
} from "@/lib/evoa-shared";

/**
 * Admin actions of the e-VOA service panel.
 *
 * Ops verifies the uploaded documents, applies on the official portal
 * (evisa.imigrasi.go.id) on behalf of the customer, then records the issued
 * visas here. Every mutation is guarded by the admin session and appends an
 * `EvoaStatusEvent` row so the order carries a full audit trail.
 *
 * Reads (`listEvoaOrders`, `getEvoaOrderAdmin`) return their data shape
 * directly (empty / null when there is no session); mutations return the
 * `{ ok }` envelope.
 */

export type EvoaAdminResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* DTOs                                                                */
/* ------------------------------------------------------------------ */

export type EvoaOrderListRow = {
  id: string;
  code: string;
  contactName: string;
  email: string;
  applicantCount: number;
  arrivalDate: string;
  status: string;
  totalUsdCents: number;
  createdAt: string;
  purposes: string[];
};

export type EvoaOrderListResult = {
  rows: EvoaOrderListRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** The minimal dynamic-field definition the admin panel needs for labels. */
export type EvoaAdminFieldDef = {
  key: string;
  labelEn: string;
  labelId: string | null;
  scope: EvoaFieldScope;
  type: EvoaFieldType;
  options: EvoaFieldOption[];
};

/** The shared event DTO plus the operator email (audit detail). */
export type EvoaAdminEventDTO = EvoaStatusEventDTO & {
  actorEmail: string | null;
};

export type EvoaApplicantAdminDTO = {
  id: string;
  applicationId: string;
  sortOrder: number;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  placeOfBirth: string;
  nationality: string;
  passportNumber: string;
  passportType: string;
  passportIssuingCountry: string;
  passportIssueDate: string | null;
  passportExpiryDate: string;
  email: string;
  phone: string;
  relation: string;
  extraAnswers: EvoaAnswers;
  status: string;
  visaNumber: string | null;
  visaPdfKey: string | null;
  issuedAt: string | null;
  visaExpiresAt: string | null;
  revisionNote: string | null;
  createdAt: string;
};

export type EvoaOrderAdminDTO = {
  id: string;
  code: string;
  status: string;
  contactName: string | null;
  email: string;
  phone: string;
  purpose: string | null;
  arrivalDate: string;
  flightNumber: string | null;
  portOfEntryId: string | null;
  portOfEntryName: string | null;
  departureDate: string | null;
  departureFlightNumber: string | null;
  hotelName: string | null;
  hotelAddress: string | null;
  hotelCity: string | null;
  hotelPostalCode: string | null;
  note: string | null;
  extraAnswers: EvoaAnswers;
  officialTransactionRef: string | null;
  revisionNote: string | null;
  paidAt: string | null;
  processingAt: string | null;
  completedAt: string | null;
  totalUsdCents: number;
  bookingId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Legacy single-applicant columns — old rows only. */
  legacy: {
    fullName: string | null;
    passportNumber: string | null;
    nationality: string | null;
    dateOfBirth: string | null;
  };
  applicants: EvoaApplicantAdminDTO[];
  documents: EvoaDocumentDTO[];
  events: EvoaAdminEventDTO[];
  fieldDefs: EvoaAdminFieldDef[];
  booking: { code: string; status: string } | null;
  payment: {
    status: string;
    provider: string | null;
    checkoutUrl: string | null;
  } | null;
};

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const NO_SESSION = "Sesi admin tidak valid. Silakan masuk ulang.";
const INVALID_TRANSITION = "Transisi status tidak valid.";
const ORDER_NOT_FOUND = "Pengajuan tidak ditemukan.";
const APPLICANT_NOT_FOUND = "Pemohon tidak ditemukan.";
const DOCUMENT_NOT_FOUND = "Dokumen tidak ditemukan.";
const NOTE_REQUIRED = "Catatan wajib diisi.";

const PAGE_SIZE = 20;

/** Order states from which ops may still ask the customer for fixes.
 * Legacy statuses are included so old rows stay operable. */
const REVISABLE_STATUSES = [
  "paid",
  "review",
  "revision",
  "processing",
  "submitted",
  "approved",
];

/** Order states that may start official-portal processing. */
const PROCESSABLE_STATUSES = ["paid", "review", "revision"];

/** Terminal states — no further workflow mutations (refund excepted). */
const TERMINAL_STATUSES = ["completed", "rejected", "refunded", "expired"];

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Json column → answers map (defensive: the column defaults to "{}"). */
function readAnswers(raw: unknown): EvoaAnswers {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as EvoaAnswers;
  }
  return {};
}

/** Json column → select options (defensive parse). */
function readOptions(raw: unknown): EvoaFieldOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const option = item as { value?: unknown; labelEn?: unknown; labelId?: unknown };
    if (typeof option.value !== "string" || typeof option.labelEn !== "string") {
      return [];
    }
    return [
      {
        value: option.value,
        labelEn: option.labelEn,
        ...(typeof option.labelId === "string" ? { labelId: option.labelId } : {}),
      },
    ];
  });
}

/** Append one audit-trail row. Every mutation goes through here. */
async function addEvent(
  applicationId: string,
  status: string,
  actorEmail: string,
  opts: { applicantId?: string | null; note?: string | null } = {},
): Promise<void> {
  await db.orm.public.EvoaStatusEvent.create({
    id: crypto.randomUUID(),
    applicationId,
    applicantId: opts.applicantId ?? null,
    status,
    note: opts.note ?? null,
    actor: "admin",
    actorEmail,
  });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * The order list of the admin panel.
 *
 * Sorted by arrival date ascending — the nearest arrival is the most urgent.
 * `q` matches the order code / contact name OR any applicant's full name or
 * passport number (applicants are queried first, then the order filter is
 * widened with the matching order ids).
 */
export async function listEvoaOrders(
  input: { status?: string; q?: string; page?: number } = {},
): Promise<EvoaOrderListResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const empty: EvoaOrderListResult = { rows: [], total: 0, page, pageSize: PAGE_SIZE };

  const session = await getAdminSession();
  if (!session) return empty;

  const status = (input.status ?? "").trim();
  const knownStatuses: string[] = [...EVOA_ORDER_STATUSES, ...EVOA_LEGACY_STATUSES];
  const hasStatus = knownStatuses.includes(status);
  const q = (input.q ?? "").trim();
  const like = `%${q}%`;

  // Applicant search first — an order also matches when one of its people
  // carries the searched name / passport number.
  let matchedOrderIds: string[] = [];
  if (q) {
    const hits = await db.orm.public.VisaApplicant
      .select("applicationId")
      .where((f) => or(f.fullName.ilike(like), f.passportNumber.ilike(like)))
      .all();
    matchedOrderIds = [...new Set(hits.map((hit) => hit.applicationId))];
  }

  // The ops dataset is small (one row per service order), so the filtered
  // set is fetched once and paginated in memory — this keeps the conditional
  // status/text filter in a single typed predicate.
  const orders = await db.orm.public.VisaApplication
    .select(
      "id",
      "code",
      "contactName",
      "email",
      "fullName",
      "arrivalDate",
      "status",
      "totalUsdCents",
      "createdAt",
      "purpose",
    )
    .where((f) => {
      const statusCond = hasStatus ? f.status.eq(status) : null;
      const textCond = q
        ? matchedOrderIds.length > 0
          ? or(f.code.ilike(like), f.contactName.ilike(like), f.id.in(matchedOrderIds))
          : or(f.code.ilike(like), f.contactName.ilike(like))
        : null;
      if (statusCond && textCond) return and(statusCond, textCond);
      // id is never null — a tautology when no filter is active.
      return statusCond ?? textCond ?? f.id.isNotNull();
    })
    .orderBy((f) => f.arrivalDate.asc())
    .all();

  const total = orders.length;
  const pageRows = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Applicant counts for the visible page only (one extra query).
  const pageIds = pageRows.map((row) => row.id);
  const applicants = pageIds.length
    ? await db.orm.public.VisaApplicant
        .select("applicationId")
        .where((f) => f.applicationId.in(pageIds))
        .all()
    : [];
  const countByOrder = new Map<string, number>();
  for (const applicant of applicants) {
    countByOrder.set(
      applicant.applicationId,
      (countByOrder.get(applicant.applicationId) ?? 0) + 1,
    );
  }

  return {
    rows: pageRows.map((row) => ({
      id: row.id,
      code: row.code,
      // Legacy rows have no contactName — fall back to the old fullName.
      contactName: row.contactName ?? row.fullName ?? "",
      email: row.email,
      applicantCount: countByOrder.get(row.id) ?? (row.fullName ? 1 : 0),
      arrivalDate: toIso(row.arrivalDate) ?? "",
      status: row.status,
      totalUsdCents: row.totalUsdCents,
      createdAt: toIso(row.createdAt) ?? "",
      purposes: row.purpose ? [row.purpose] : [],
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * The full admin view of one order: order fields, applicants, documents,
 * audit trail, dynamic-field labels and the linked booking / payment.
 * Returns null when the code is unknown (or there is no session).
 */
export async function getEvoaOrderAdmin(
  code: string,
): Promise<EvoaOrderAdminDTO | null> {
  const session = await getAdminSession();
  if (!session) return null;

  const order = await db.orm.public.VisaApplication.where({ code }).first();
  if (!order) return null;

  const [applicantRows, documentRows, eventRows, fieldRows] = await Promise.all([
    db.orm.public.VisaApplicant
      .where((f) => f.applicationId.eq(order.id))
      .orderBy((f) => f.sortOrder.asc())
      .all(),
    db.orm.public.VisaDocument
      .where((f) => f.applicationId.eq(order.id))
      .orderBy([(f) => f.sortOrder.asc(), (f) => f.createdAt.asc()])
      .all(),
    db.orm.public.EvoaStatusEvent
      .where((f) => f.applicationId.eq(order.id))
      .orderBy((f) => f.createdAt.desc())
      .all(),
    db.orm.public.EvoaFormField
      .select("key", "labelEn", "labelId", "scope", "type", "options", "sortOrder")
      .where((f) => f.active.eq(true))
      .orderBy((f) => f.sortOrder.asc())
      .all(),
  ]);

  // Booking + payment only exist for orders created through the internal
  // eVOA flow (bookingId set).
  const bookingId = order.bookingId;
  const booking = bookingId
    ? await db.orm.public.Booking
        .select("code", "status")
        .where({ id: bookingId })
        .first()
    : null;
  const payment = bookingId
    ? await db.orm.public.Payment
        .select("status", "provider", "checkoutUrl")
        .where((f) => f.bookingId.eq(bookingId))
        .orderBy((f) => f.createdAt.desc())
        .first()
    : null;

  const applicants: EvoaApplicantAdminDTO[] = applicantRows.map((row) => ({
    id: row.id,
    applicationId: row.applicationId,
    sortOrder: row.sortOrder,
    fullName: row.fullName,
    gender: row.gender,
    dateOfBirth: toIso(row.dateOfBirth) ?? "",
    placeOfBirth: row.placeOfBirth,
    nationality: row.nationality,
    passportNumber: row.passportNumber,
    passportType: row.passportType,
    passportIssuingCountry: row.passportIssuingCountry,
    passportIssueDate: toIso(row.passportIssueDate),
    passportExpiryDate: toIso(row.passportExpiryDate) ?? "",
    email: row.email,
    phone: row.phone,
    relation: row.relation,
    extraAnswers: readAnswers(row.extraAnswers),
    status: row.status,
    visaNumber: row.visaNumber,
    visaPdfKey: row.visaPdfKey,
    issuedAt: toIso(row.issuedAt),
    visaExpiresAt: toIso(row.visaExpiresAt),
    revisionNote: row.revisionNote,
    createdAt: toIso(row.createdAt) ?? "",
  }));

  const documents: EvoaDocumentDTO[] = documentRows.map((row) => ({
    id: row.id,
    applicantId: row.applicantId,
    slot: row.slot,
    key: row.key,
    url: row.url,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sortOrder: row.sortOrder,
    reviewStatus: row.reviewStatus,
    reviewNote: row.reviewNote,
  }));

  const events: EvoaAdminEventDTO[] = eventRows.map((row) => ({
    id: row.id,
    applicantId: row.applicantId,
    status: row.status,
    note: row.note,
    actor: row.actor,
    actorEmail: row.actorEmail,
    createdAt: toIso(row.createdAt) ?? "",
  }));

  // Inline mapping of EvoaFormField rows — the shared evoa-fields helper is
  // owned elsewhere; the admin panel only needs labels + types.
  const fieldDefs: EvoaAdminFieldDef[] = fieldRows.map((row) => ({
    key: row.key,
    labelEn: row.labelEn,
    labelId: row.labelId,
    scope: row.scope === "application" ? "application" : "applicant",
    type: (EVOA_FIELD_TYPES as readonly string[]).includes(row.type)
      ? (row.type as EvoaFieldType)
      : "text",
    options: readOptions(row.options),
  }));

  return {
    id: order.id,
    code: order.code,
    status: order.status,
    contactName: order.contactName,
    email: order.email,
    phone: order.phone,
    purpose: order.purpose,
    arrivalDate: toIso(order.arrivalDate) ?? "",
    flightNumber: order.flightNumber,
    portOfEntryId: order.portOfEntryId,
    portOfEntryName: order.portOfEntryName,
    departureDate: toIso(order.departureDate),
    departureFlightNumber: order.departureFlightNumber,
    hotelName: order.hotelName,
    hotelAddress: order.hotelAddress,
    hotelCity: order.hotelCity,
    hotelPostalCode: order.hotelPostalCode,
    note: order.note,
    extraAnswers: readAnswers(order.extraAnswers),
    officialTransactionRef: order.officialTransactionRef,
    revisionNote: order.revisionNote,
    paidAt: toIso(order.paidAt),
    processingAt: toIso(order.processingAt),
    completedAt: toIso(order.completedAt),
    totalUsdCents: order.totalUsdCents,
    bookingId: order.bookingId,
    createdAt: toIso(order.createdAt) ?? "",
    updatedAt: toIso(order.updatedAt) ?? "",
    legacy: {
      fullName: order.fullName,
      passportNumber: order.passportNumber,
      nationality: order.nationality,
      dateOfBirth: toIso(order.dateOfBirth),
    },
    applicants,
    documents,
    events,
    fieldDefs,
    booking: booking ? { code: booking.code, status: booking.status } : null,
    payment: payment
      ? {
          status: payment.status,
          provider: payment.provider,
          checkoutUrl: payment.checkoutUrl,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Document review                                                     */
/* ------------------------------------------------------------------ */

/** Mark one uploaded document as verified or in need of a re-upload. */
export async function reviewDocument(
  documentId: string,
  reviewStatus: "ok" | "revision",
  note?: string,
): Promise<EvoaAdminResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: NO_SESSION };

  if (reviewStatus !== "ok" && reviewStatus !== "revision") {
    return { ok: false, error: "Status review tidak valid." };
  }
  const trimmedNote = note?.trim() || null;
  if (reviewStatus === "revision" && !trimmedNote) {
    return { ok: false, error: NOTE_REQUIRED };
  }

  const doc = await db.orm.public.VisaDocument.where({ id: documentId }).first();
  if (!doc) return { ok: false, error: DOCUMENT_NOT_FOUND };

  await db.orm.public.VisaDocument.where({ id: documentId }).update({
    reviewStatus,
    reviewNote: trimmedNote,
  });

  const slotLabel = evoaDocSlot(doc.slot)?.id ?? doc.slot;
  await addEvent(doc.applicationId, "review", session.email, {
    applicantId: doc.applicantId,
    note:
      `Dokumen ${slotLabel} "${doc.fileName}" ditandai ` +
      (reviewStatus === "ok" ? "OK" : "perlu revisi") +
      (trimmedNote ? ` — ${trimmedNote}` : ""),
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Revisions                                                           */
/* ------------------------------------------------------------------ */

/** Ask one applicant to fix their data / documents. */
export async function requestApplicantRevision(
  applicantId: string,
  note: string,
): Promise<EvoaAdminResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: NO_SESSION };

  const trimmedNote = note?.trim();
  if (!trimmedNote) return { ok: false, error: NOTE_REQUIRED };

  const applicant = await db.orm.public.VisaApplicant
    .where({ id: applicantId })
    .first();
  if (!applicant) return { ok: false, error: APPLICANT_NOT_FOUND };
  if (applicant.status === "issued" || applicant.status === "rejected") {
    return { ok: false, error: INVALID_TRANSITION };
  }

  const order = await db.orm.public.VisaApplication
    .where({ id: applicant.applicationId })
    .first();
  if (!order) return { ok: false, error: ORDER_NOT_FOUND };
  if (!REVISABLE_STATUSES.includes(order.status)) {
    return { ok: false, error: INVALID_TRANSITION };
  }

  await db.orm.public.VisaApplicant.where({ id: applicantId }).update({
    status: "revision",
    revisionNote: trimmedNote,
  });
  // The whole order surfaces as "needs revision" to the customer.
  await db.orm.public.VisaApplication.where({ id: order.id }).update({
    status: "revision",
    revisionNote: trimmedNote,
  });

  await addEvent(order.id, "revision", session.email, {
    applicantId,
    note: `Revisi diminta untuk ${applicant.fullName}: ${trimmedNote}`,
  });
  void notifyEvoaStatusChange(order.id, "revision", `Revisi diminta untuk ${applicant.fullName}.`);

  return { ok: true };
}

/** Ask the pemesan to fix order-level data / documents. */
export async function requestOrderRevision(
  applicationId: string,
  note: string,
): Promise<EvoaAdminResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: NO_SESSION };

  const trimmedNote = note?.trim();
  if (!trimmedNote) return { ok: false, error: NOTE_REQUIRED };

  const order = await db.orm.public.VisaApplication
    .where({ id: applicationId })
    .first();
  if (!order) return { ok: false, error: ORDER_NOT_FOUND };
  if (!REVISABLE_STATUSES.includes(order.status)) {
    return { ok: false, error: INVALID_TRANSITION };
  }

  await db.orm.public.VisaApplication.where({ id: applicationId }).update({
    status: "revision",
    revisionNote: trimmedNote,
  });

  await addEvent(applicationId, "revision", session.email, {
    note: trimmedNote,
  });
  void notifyEvoaStatusChange(applicationId, "revision", trimmedNote);

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Processing                                                          */
/* ------------------------------------------------------------------ */

/**
 * Ops starts applying on the official portal. The portal transaction
 * reference (when already known) is stored for traceability.
 */
export async function startProcessing(
  applicationId: string,
  officialTransactionRef?: string,
): Promise<EvoaAdminResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: NO_SESSION };

  const order = await db.orm.public.VisaApplication
    .where({ id: applicationId })
    .first();
  if (!order) return { ok: false, error: ORDER_NOT_FOUND };
  if (!PROCESSABLE_STATUSES.includes(order.status)) {
    return { ok: false, error: INVALID_TRANSITION };
  }

  const ref = officialTransactionRef?.trim() || null;
  await db.orm.public.VisaApplication.where({ id: applicationId }).update({
    status: "processing",
    processingAt: new Date(),
    // Keep the previously stored ref when none is supplied now.
    officialTransactionRef: ref ?? order.officialTransactionRef,
  });

  // Every applicant still in the pipeline moves with the order — issued or
  // rejected people are left untouched.
  const applicants = await db.orm.public.VisaApplicant
    .select("id", "status")
    .where((f) => f.applicationId.eq(applicationId))
    .all();
  for (const applicant of applicants) {
    if (applicant.status === "rejected" || applicant.status === "issued") continue;
    await db.orm.public.VisaApplicant
      .where({ id: applicant.id })
      .update({ status: "processing" });
  }

  await addEvent(applicationId, "processing", session.email, {
    note: ref ? `Proses di portal resmi dimulai. Ref: ${ref}` : "Proses di portal resmi dimulai.",
  });
  void notifyEvoaStatusChange(applicationId, "processing");

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Issuing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Record one issued e-VOA. The PDF is uploaded first (admin-only upload
 * route) and its R2 key passed here. When every applicant of the order is
 * issued, the order itself flips to "issued".
 */
export async function issueApplicantVisa(
  applicantId: string,
  input: { visaNumber: string; visaPdfKey: string; visaExpiresAt?: string },
): Promise<EvoaAdminResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: NO_SESSION };

  const visaNumber = input.visaNumber?.trim();
  const visaPdfKey = input.visaPdfKey?.trim();
  if (!visaNumber) return { ok: false, error: "Nomor visa wajib diisi." };
  if (!visaPdfKey) return { ok: false, error: "File PDF visa wajib diunggah." };

  let visaExpiresAt: Date | null = null;
  if (input.visaExpiresAt) {
    const parsed = new Date(input.visaExpiresAt);
    if (!Number.isFinite(parsed.getTime())) {
      return { ok: false, error: "Tanggal kedaluwarsa visa tidak valid." };
    }
    visaExpiresAt = parsed;
  }

  const applicant = await db.orm.public.VisaApplicant
    .where({ id: applicantId })
    .first();
  if (!applicant) return { ok: false, error: APPLICANT_NOT_FOUND };
  if (applicant.status === "rejected") {
    return { ok: false, error: INVALID_TRANSITION };
  }

  const order = await db.orm.public.VisaApplication
    .where({ id: applicant.applicationId })
    .first();
  if (!order) return { ok: false, error: ORDER_NOT_FOUND };
  if (order.status !== "processing" && order.status !== "issued") {
    return { ok: false, error: INVALID_TRANSITION };
  }

  const issuedAt = new Date();
  // e-VOA is valid 90 days from issue unless ops records another date.
  const expiresAt =
    visaExpiresAt ?? new Date(issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000);

  await db.orm.public.VisaApplicant.where({ id: applicantId }).update({
    status: "issued",
    visaNumber,
    visaPdfKey,
    issuedAt,
    visaExpiresAt: expiresAt,
  });

  await addEvent(order.id, "issued", session.email, {
    applicantId,
    note: `e-VOA terbit untuk ${applicant.fullName}: ${visaNumber}`,
  });

  // All people issued → the order is issued too (one group event).
  const all = await db.orm.public.VisaApplicant
    .select("status")
    .where((f) => f.applicationId.eq(order.id))
    .all();
  if (
    order.status !== "issued" &&
    all.length > 0 &&
    all.every((row) => row.status === "issued")
  ) {
    await db.orm.public.VisaApplication
      .where({ id: order.id })
      .update({ status: "issued" });
    await addEvent(order.id, "issued", session.email, {
      note: "Semua e-VOA pemohon telah terbit.",
    });
    void notifyEvoaStatusChange(order.id, "issued", "Semua e-VOA pemohon telah terbit.");
  }

  return { ok: true };
}

/** Close the order once every applicant holds an issued visa. */
export async function completeOrder(
  applicationId: string,
): Promise<EvoaAdminResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: NO_SESSION };

  const order = await db.orm.public.VisaApplication
    .where({ id: applicationId })
    .first();
  if (!order) return { ok: false, error: ORDER_NOT_FOUND };
  if (order.status !== "processing" && order.status !== "issued") {
    return { ok: false, error: INVALID_TRANSITION };
  }

  const applicants = await db.orm.public.VisaApplicant
    .select("status")
    .where((f) => f.applicationId.eq(applicationId))
    .all();
  // Legacy orders without applicants cannot be completed through this flow.
  if (applicants.length === 0 || !applicants.every((row) => row.status === "issued")) {
    return { ok: false, error: INVALID_TRANSITION };
  }

  await db.orm.public.VisaApplication.where({ id: applicationId }).update({
    status: "completed",
    completedAt: new Date(),
  });

  await addEvent(applicationId, "completed", session.email, {
    note: "Pesanan selesai — semua visa telah diterbitkan.",
  });
  void notifyEvoaStatusChange(applicationId, "completed");

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Rejection & refund                                                  */
/* ------------------------------------------------------------------ */

/** Reject the order; applicants without an issued visa are rejected too. */
export async function rejectOrder(
  applicationId: string,
  note: string,
): Promise<EvoaAdminResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: NO_SESSION };

  const trimmedNote = note?.trim();
  if (!trimmedNote) return { ok: false, error: NOTE_REQUIRED };

  const order = await db.orm.public.VisaApplication
    .where({ id: applicationId })
    .first();
  if (!order) return { ok: false, error: ORDER_NOT_FOUND };
  if (
    TERMINAL_STATUSES.includes(order.status) ||
    order.status === "draft" ||
    order.status === "awaiting_payment"
  ) {
    return { ok: false, error: INVALID_TRANSITION };
  }

  await db.orm.public.VisaApplication
    .where({ id: applicationId })
    .update({ status: "rejected" });

  const applicants = await db.orm.public.VisaApplicant
    .select("id", "status")
    .where((f) => f.applicationId.eq(applicationId))
    .all();
  for (const applicant of applicants) {
    if (applicant.status === "issued") continue;
    await db.orm.public.VisaApplicant
      .where({ id: applicant.id })
      .update({ status: "rejected" });
  }

  await addEvent(applicationId, "rejected", session.email, {
    note: trimmedNote,
  });
  void notifyEvoaStatusChange(applicationId, "rejected", trimmedNote);

  return { ok: true };
}

/**
 * Mark the order refunded. Money movement is manual (ops transfers outside
 * the system) — this only records the state and the note.
 */
export async function refundOrder(
  applicationId: string,
  note: string,
): Promise<EvoaAdminResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: NO_SESSION };

  const trimmedNote = note?.trim();
  if (!trimmedNote) return { ok: false, error: NOTE_REQUIRED };

  const order = await db.orm.public.VisaApplication
    .where({ id: applicationId })
    .first();
  if (!order) return { ok: false, error: ORDER_NOT_FOUND };
  // A refund only makes sense once money was (or should have been) received.
  if (
    order.status === "draft" ||
    order.status === "awaiting_payment" ||
    order.status === "refunded" ||
    order.status === "expired"
  ) {
    return { ok: false, error: INVALID_TRANSITION };
  }

  await db.orm.public.VisaApplication
    .where({ id: applicationId })
    .update({ status: "refunded" });

  await addEvent(applicationId, "refunded", session.email, {
    note: `Refund dicatat (dana dikembalikan manual): ${trimmedNote}`,
  });
  void notifyEvoaStatusChange(applicationId, "refunded");

  return { ok: true };
}
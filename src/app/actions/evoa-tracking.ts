"use server";

import { db } from "@/prisma/db";
import { getUserSession } from "@/lib/user/session";
import { listOrderDocuments } from "@/lib/evoa-docs";
import { listEvoaFieldDefs } from "@/lib/evoa-fields";
import type { EvoaAnswers, EvoaDocumentDTO } from "@/lib/evoa-shared";

/**
 * Customer-facing tracking actions of the e-VOA service.
 *
 * Reads are session-guarded and scoped to the signed-in customer's own
 * orders — the tracking page never exposes another customer's passport data.
 * The one exception is `getEvoaLinkForBooking`, used by the payment return
 * page: it only maps a booking code (which the payer already holds) to the
 * application code, nothing more.
 */

export type EvoaTrackingListRow = {
  id: string;
  code: string;
  status: string;
  arrivalDate: string;
  createdAt: string;
  totalUsdCents: number;
  applicantCount: number;
  applicants: { id: string; fullName: string; status: string; visaNumber: string | null }[];
  primaryName: string;
};

/** Alias used by the account OrdersPanel. */
export type EvoaOrderSummaryDTO = EvoaTrackingListRow;

export type EvoaTrackingApplicantDTO = {
  id: string;
  sortOrder: number;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  placeOfBirth: string;
  nationality: string;
  /** Resolved country name (falls back to the code when unknown). */
  nationalityName: string | null;
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
};

export type EvoaTrackingEvent = {
  id: string;
  applicantId: string | null;
  status: string;
  note: string | null;
  actor: string;
  createdAt: string;
};

/** The minimal dynamic-field definition the tracking page needs for labels. */
export type EvoaTrackingFieldDef = {
  key: string;
  labelEn: string;
  labelId: string | null;
  scope: string;
  type: string;
};

export type EvoaTrackingDTO = {
  id: string;
  code: string;
  status: string;
  contactName: string | null;
  email: string;
  phone: string;
  purpose: string | null;
  arrivalDate: string;
  flightNumber: string | null;
  portOfEntryName: string | null;
  departureDate: string | null;
  departureFlightNumber: string | null;
  hotelName: string | null;
  hotelAddress: string | null;
  hotelCity: string | null;
  hotelPostalCode: string | null;
  note: string | null;
  extraAnswers: EvoaAnswers;
  revisionNote: string | null;
  totalUsdCents: number;
  paidAt: string | null;
  createdAt: string;
  /** Legacy single-applicant columns — old rows only. */
  legacy: {
    fullName: string | null;
    passportNumber: string | null;
    nationality: string | null;
    dateOfBirth: string | null;
  };
  applicants: EvoaTrackingApplicantDTO[];
  documents: EvoaDocumentDTO[];
  events: EvoaTrackingEvent[];
  fieldDefs: EvoaTrackingFieldDef[];
  booking: { code: string; status: string } | null;
  payment: { status: string; checkoutUrl: string | null } | null;
};

const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/** The e-VOA orders of the signed-in customer — newest first. */
export async function listMyEvoaOrders(): Promise<EvoaTrackingListRow[]> {
  const session = await getUserSession();
  if (!session) return [];

  const orders = await db.orm.public.VisaApplication
    .select(
      "id",
      "code",
      "status",
      "arrivalDate",
      "createdAt",
      "totalUsdCents",
      "contactName",
      "fullName",
    )
    .where((f) => f.userId.eq(session.uid))
    .orderBy((f) => f.createdAt.desc())
    .all();

  if (orders.length === 0) return [];

  const applicants = await db.orm.public.VisaApplicant
    .select("id", "applicationId", "fullName", "status", "visaNumber", "sortOrder")
    .where((f) => f.applicationId.in(orders.map((o) => o.id)))
    .orderBy((f) => f.sortOrder.asc())
    .all();

  return orders.map((order) => {
    const people = applicants.filter((a) => a.applicationId === order.id);
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      arrivalDate: new Date(order.arrivalDate).toISOString(),
      createdAt: new Date(order.createdAt).toISOString(),
      totalUsdCents: order.totalUsdCents,
      applicantCount: people.length,
      applicants: people.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        status: p.status,
        visaNumber: p.visaNumber,
      })),
      primaryName: people[0]?.fullName ?? order.fullName ?? order.contactName ?? "—",
    };
  });
}

/** One order with everything the tracking page renders — owner only. */
export async function getEvoaTracking(code: string): Promise<EvoaTrackingDTO | null> {
  const session = await getUserSession();
  if (!session) return null;

  const order = await db.orm.public.VisaApplication
    .where({ code: code.trim().toUpperCase() })
    .first();
  if (!order || order.userId !== session.uid) return null;

  const applicants = await db.orm.public.VisaApplicant
    .where((f) => f.applicationId.eq(order.id))
    .orderBy((f) => f.sortOrder.asc())
    .all();

  // Resolve nationality codes to display names in one query.
  const codes = [...new Set(applicants.map((a) => a.nationality))];
  const countries = codes.length
    ? await db.orm.public.Country
        .select("code", "name")
        .where((f) => f.code.in(codes))
        .all()
    : [];
  const countryName = new Map(countries.map((c) => [c.code, c.name]));

  const events = await db.orm.public.EvoaStatusEvent
    .where((f) => f.applicationId.eq(order.id))
    .orderBy((f) => f.createdAt.desc())
    .all();

  const [documents, applicationDefs, applicantDefs] = await Promise.all([
    listOrderDocuments(order.id),
    listEvoaFieldDefs("application"),
    listEvoaFieldDefs("applicant"),
  ]);

  let booking: EvoaTrackingDTO["booking"] = null;
  let payment: EvoaTrackingDTO["payment"] = null;
  if (order.bookingId) {
    const bookingRow = await db.orm.public.Booking
      .select("id", "code", "status")
      .where({ id: order.bookingId })
      .first();
    if (bookingRow) {
      booking = { code: bookingRow.code, status: bookingRow.status };
      const paymentRow = await db.orm.public.Payment
        .select("status", "checkoutUrl", "createdAt")
        .where((f) => f.bookingId.eq(bookingRow.id))
        .orderBy((f) => f.createdAt.desc())
        .first();
      if (paymentRow) {
        payment = { status: paymentRow.status, checkoutUrl: paymentRow.checkoutUrl };
      }
    }
  }

  return {
    id: order.id,
    code: order.code,
    status: order.status,
    contactName: order.contactName,
    email: order.email,
    phone: order.phone,
    purpose: order.purpose,
    arrivalDate: new Date(order.arrivalDate).toISOString(),
    flightNumber: order.flightNumber,
    portOfEntryName: order.portOfEntryName,
    departureDate: iso(order.departureDate),
    departureFlightNumber: order.departureFlightNumber,
    hotelName: order.hotelName,
    hotelAddress: order.hotelAddress,
    hotelCity: order.hotelCity,
    hotelPostalCode: order.hotelPostalCode,
    note: order.note,
    extraAnswers: (order.extraAnswers ?? {}) as EvoaAnswers,
    revisionNote: order.revisionNote,
    totalUsdCents: order.totalUsdCents,
    paidAt: iso(order.paidAt),
    createdAt: new Date(order.createdAt).toISOString(),
    legacy: {
      fullName: order.fullName,
      passportNumber: order.passportNumber,
      nationality: order.nationality,
      dateOfBirth: iso(order.dateOfBirth),
    },
    applicants: applicants.map((a) => ({
      id: a.id,
      sortOrder: a.sortOrder,
      fullName: a.fullName,
      gender: a.gender,
      dateOfBirth: new Date(a.dateOfBirth).toISOString(),
      placeOfBirth: a.placeOfBirth,
      nationality: a.nationality,
      nationalityName: countryName.get(a.nationality) ?? a.nationality,
      passportNumber: a.passportNumber,
      passportType: a.passportType,
      passportIssuingCountry: a.passportIssuingCountry,
      passportIssueDate: iso(a.passportIssueDate),
      passportExpiryDate: new Date(a.passportExpiryDate).toISOString(),
      email: a.email,
      phone: a.phone,
      relation: a.relation,
      extraAnswers: (a.extraAnswers ?? {}) as EvoaAnswers,
      status: a.status,
      visaNumber: a.visaNumber,
      visaPdfKey: a.visaPdfKey,
      issuedAt: iso(a.issuedAt),
      visaExpiresAt: iso(a.visaExpiresAt),
      revisionNote: a.revisionNote,
    })),
    documents,
    events: events.map((e) => ({
      id: e.id,
      applicantId: e.applicantId,
      status: e.status,
      note: e.note,
      actor: e.actor,
      createdAt: new Date(e.createdAt).toISOString(),
    })),
    fieldDefs: [...applicationDefs, ...applicantDefs].map((d) => ({
      key: d.key,
      labelEn: d.labelEn,
      labelId: d.labelId,
      scope: d.scope,
      type: d.type,
    })),
    booking,
    payment,
  };
}

/**
 * Map a booking code to its e-VOA application code — used by the payment
 * return page to offer the tracking link. Deliberately session-free: the
 * caller already holds the booking code from the gateway redirect, and the
 * response exposes nothing beyond the matching application code.
 */
export async function getEvoaLinkForBooking(
  bookingCode: string,
): Promise<{ code: string } | null> {
  const code = bookingCode.trim().toUpperCase();
  if (!code) return null;

  const booking = await db.orm.public.Booking
    .select("id")
    .where({ code })
    .first();
  if (!booking) return null;

  const order = await db.orm.public.VisaApplication
    .select("code")
    .where((f) => f.bookingId.eq(booking.id))
    .first();
  return order ? { code: order.code } : null;
}
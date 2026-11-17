"use server";

import { db } from "@/prisma/db";
import { getUserSession } from "@/lib/user/session";
import { generateApplicationCode } from "@/lib/invoice";
import { listEvoaFieldDefs, validateScopeAnswers } from "@/lib/evoa-fields";
import { getEvoaSettings, quoteEvoa, type EvoaQuote } from "@/lib/evoa-pricing";
import { createEvoaBooking } from "@/lib/evoa-booking";
import { createDocumentRows, deleteDocumentRow } from "@/lib/evoa-docs";
import {
  EVOA_DOC_SLOTS,
  EVOA_EMAIL_RE,
  EVOA_GENDERS,
  EVOA_PASSPORT_RE,
  EVOA_PASSPORT_TYPES,
  EVOA_PHONE_RE,
  EVOA_PURPOSES,
  EVOA_RELATIONS,
  evoaDocSlot,
  normalizePassportNumber,
  validatePassportValidity,
  type EvoaAnswers,
  type EvoaApplicantInput,
  type EvoaFieldDefDTO,
  type EvoaFileRef,
  type EvoaOrderInput,
} from "@/lib/evoa-shared";

/**
 * The customer-facing e-VOA order actions.
 *
 * Every action re-reads the session cookie and re-validates the whole payload
 * on the server — the wizard's client checks are a convenience, never a
 * trust boundary. An action is reachable by direct POST, so nothing the
 * client sends (file references included) is taken at face value.
 *
 * The submit flow mirrors the booking pipeline: the order is created as a
 * "draft" first, then `createEvoaBooking` prepares the payable Booking. If
 * the booking fails the draft survives and the customer can retry; only a
 * successful booking flips the order to "awaiting_payment".
 */

export type EvoaResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

function fail(error: string, field?: string): { ok: false; error: string; field?: string } {
  return { ok: false, error, field };
}

/* ------------------------------------------------------------------ */
/* Small validation helpers                                            */
/* ------------------------------------------------------------------ */

/** Untrusted wire value → trimmed string (anything else is empty). */
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Today as a local YYYY-MM-DD string — day-granular comparisons are done
 * on ISO strings so the server timezone never shifts a calendar day. */
function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Strict YYYY-MM-DD check (round-trips through Date to reject 2026-02-31). */
function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return false;
  return new Date(time).toISOString().slice(0, 10) === value;
}

const FLIGHT_RE = /^[A-Z0-9]{2,12}$/;

/** The MIME types / size cap the upload route enforces for dynamic file
 * fields — mirrored here so a forged reference cannot bypass them. */
const DYNAMIC_FILE_ACCEPT = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const DYNAMIC_FILE_MAX_BYTES = 8 * 1024 * 1024;

type RefCheck = { ok: true; refs: EvoaFileRef[] } | { ok: false; error: string };

/**
 * Validate a list of uploaded-file references. The bytes already live in R2
 * (the upload route checked them); here we verify the *reference* shape and
 * that it points at our own bucket prefix with a plausible type/size.
 */
function checkRefs(
  raw: unknown,
  rules: { maxFiles: number; accept: string[]; maxBytes: number },
  label: string,
): RefCheck {
  if (!Array.isArray(raw)) return { ok: false, error: `Dokumen ${label} tidak valid.` };
  if (raw.length > rules.maxFiles) {
    return { ok: false, error: `Dokumen ${label} maksimal ${rules.maxFiles} file.` };
  }
  const refs: EvoaFileRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: `Referensi file ${label} tidak valid.` };
    }
    const ref = entry as Partial<EvoaFileRef>;
    if (
      typeof ref.key !== "string" ||
      !ref.key.startsWith("evoa-docs/") ||
      typeof ref.url !== "string" ||
      ref.url.length === 0 ||
      typeof ref.fileName !== "string" ||
      ref.fileName.length === 0 ||
      typeof ref.mimeType !== "string" ||
      typeof ref.sizeBytes !== "number" ||
      !Number.isFinite(ref.sizeBytes) ||
      ref.sizeBytes <= 0
    ) {
      return { ok: false, error: `Referensi file ${label} tidak valid.` };
    }
    if (!rules.accept.includes(ref.mimeType)) {
      return { ok: false, error: `Format file ${label} tidak didukung.` };
    }
    if (ref.sizeBytes > rules.maxBytes) {
      return { ok: false, error: `Ukuran file ${label} melebihi batas.` };
    }
    refs.push({
      key: ref.key,
      url: ref.url,
      fileName: ref.fileName,
      mimeType: ref.mimeType,
      sizeBytes: ref.sizeBytes,
    });
  }
  return { ok: true, refs };
}

/** Rules of one document slot: a standard slot, or an admin-defined file
 * field whose key doubles as the slot. Null = unknown slot. */
function slotRules(
  slot: string,
  fileDefs: EvoaFieldDefDTO[],
): { maxFiles: number; accept: string[]; maxBytes: number } | null {
  const standard = evoaDocSlot(slot);
  if (standard) {
    return { maxFiles: standard.maxFiles, accept: standard.accept, maxBytes: standard.maxBytes };
  }
  const def = fileDefs.find((d) => d.key === slot && d.type === "file");
  if (def) {
    return {
      maxFiles: def.maxFiles ?? 1,
      accept: DYNAMIC_FILE_ACCEPT,
      maxBytes: DYNAMIC_FILE_MAX_BYTES,
    };
  }
  return null;
}

/** Keep only answers for defined keys, coerced to the field's value shape.
 * File references are kept as-is (they are small) — the order/applicant
 * extraAnswers Json is the record of what the customer uploaded. */
function sanitizeAnswers(defs: EvoaFieldDefDTO[], raw: unknown): EvoaAnswers {
  const out: EvoaAnswers = {};
  if (!raw || typeof raw !== "object") return out;
  const record = raw as Record<string, unknown>;
  for (const def of defs) {
    const value = record[def.key];
    if (value === undefined) continue;
    if (def.type === "file") {
      out[def.key] = Array.isArray(value) ? (value as EvoaFileRef[]) : [];
    } else if (def.type === "checkbox") {
      out[def.key] = value === true;
    } else {
      out[def.key] = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
    }
  }
  return out;
}

/** Append one customer action to the order's audit trail. */
async function recordEvent(params: {
  applicationId: string;
  applicantId?: string | null;
  status: string;
  note?: string | null;
  actorEmail: string;
}): Promise<void> {
  await db.orm.public.EvoaStatusEvent.create({
    id: crypto.randomUUID(),
    applicationId: params.applicationId,
    applicantId: params.applicantId ?? null,
    status: params.status,
    note: params.note ?? null,
    actor: "customer",
    actorEmail: params.actorEmail,
  });
}

/* ------------------------------------------------------------------ */
/* Form data                                                           */
/* ------------------------------------------------------------------ */

export type EvoaFormData = {
  countries: { code: string; name: string }[];
  airports: { id: string; name: string; iataCode: string | null; city: string }[];
  fieldDefs: { application: EvoaFieldDefDTO[]; applicant: EvoaFieldDefDTO[] };
  settings: {
    maxApplicants: number;
    slaHours: number;
    minLeadTimeDays: number;
    serviceFeeUsdCents: number;
    officialFeeIdr: number;
  };
  quote: EvoaQuote;
};

/** Everything the wizard needs to render: eligible nationalities, arrival
 * checkpoints, dynamic fields, operator settings and a 1-person quote. */
export async function getEvoaFormData(): Promise<EvoaResult<EvoaFormData>> {
  const session = await getUserSession();
  if (!session) return fail("Sesi tidak valid. Silakan masuk kembali.");

  try {
    const [countryRows, airportRows, applicationDefs, applicantDefs, settings, quote] =
      await Promise.all([
        db.orm.public.Country
          .select("code", "name")
          .where((f) => f.voaEligible.eq(true))
          .where((f) => f.active.eq(true))
          .orderBy((f) => f.name.asc())
          .all(),
        db.orm.public.Airport
          .select("id", "name", "iataCode", "city")
          .where((f) => f.kind.eq("airport"))
          .where((f) => f.active.eq(true))
          .where((f) => f.country.eq("Indonesia"))
          .orderBy((f) => f.name.asc())
          .all(),
        listEvoaFieldDefs("application"),
        listEvoaFieldDefs("applicant"),
        getEvoaSettings(),
        quoteEvoa(1),
      ]);

    return {
      ok: true,
      data: {
        countries: countryRows.map((row) => ({ code: row.code, name: row.name })),
        airports: airportRows.map((row) => ({
          id: row.id,
          name: row.name,
          iataCode: row.iataCode ?? null,
          city: row.city,
        })),
        fieldDefs: { application: applicationDefs, applicant: applicantDefs },
        settings: {
          maxApplicants: settings.maxApplicants,
          slaHours: settings.slaHours,
          minLeadTimeDays: settings.minLeadTimeDays,
          serviceFeeUsdCents: settings.serviceFeeUsdCents,
          officialFeeIdr: settings.officialFeeIdr,
        },
        quote,
      },
    };
  } catch (error) {
    console.error("[evoa] could not load the form data", error);
    return fail("Data formulir tidak bisa dimuat. Coba lagi.");
  }
}

/**
 * A live quote for `applicantCount` people — the review step fetches this so
 * the price breakdown (fees, taxes, total) is the exact amount the submit
 * path charges, not a per-person estimate multiplied on the client.
 */
export async function quoteEvoaFor(
  applicantCount: number,
): Promise<EvoaResult<EvoaQuote>> {
  const session = await getUserSession();
  if (!session) return fail("Sesi tidak valid. Silakan masuk kembali.");

  const count = Math.floor(Number(applicantCount) || 0);
  const { maxApplicants } = await getEvoaSettings();
  if (count < 1 || count > maxApplicants) {
    return fail("Jumlah pemohon tidak valid.", "applicants");
  }

  try {
    return { ok: true, data: await quoteEvoa(count) };
  } catch (error) {
    console.error("[evoa] could not quote the order", error);
    return fail("Gagal menghitung harga. Coba lagi.");
  }
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

/** One applicant after server-side normalization/validation. */
type CleanApplicant = {
  fullName: string;
  gender: string;
  dateOfBirth: Date;
  placeOfBirth: string;
  nationality: string;
  passportNumber: string;
  passportType: string;
  passportIssuingCountry: string;
  passportIssueDate: Date | null;
  passportExpiryDate: Date;
  email: string;
  phone: string;
  relation: string;
  extraAnswers: EvoaAnswers;
  documents: Record<string, EvoaFileRef[]>;
};

/**
 * Create an e-VOA order for 1..maxApplicants people and prepare its payment.
 *
 * Validation is exhaustive and mirrors the wizard's client checks; errors
 * carry a `field` key so the UI can jump to the offending input. Applicant
 * fields are addressed as `applicant:<index>:<name>`, their documents as
 * `applicant:<index>:doc:<slot>`, dynamic answers as `field:<key>` (order)
 * or `applicant:<index>:field:<key>`.
 */
export async function submitEvoaApplication(
  input: EvoaOrderInput,
): Promise<EvoaResult<{ code: string; bookingCode: string; totalUsdCents: number }>> {
  const session = await getUserSession();
  if (!session) return fail("Sesi tidak valid. Silakan masuk kembali.");

  try {
    /* ---------------- travel plan ---------------- */

    const contactName = str(input.contactName);
    const email = str(input.email).toLowerCase();
    const phone = str(input.phone);
    const purpose = str(input.purpose);
    const arrivalDate = str(input.arrivalDate);
    const flightNumber = str(input.flightNumber).toUpperCase();
    const portOfEntryId = str(input.portOfEntryId);
    const departureDate = str(input.departureDate);
    const departureFlightNumber = str(input.departureFlightNumber).toUpperCase();
    const hotelName = str(input.hotelName);
    const hotelAddress = str(input.hotelAddress);
    const hotelCity = str(input.hotelCity);
    const hotelPostalCode = str(input.hotelPostalCode);
    const note = str(input.note);

    if (contactName.length < 3) return fail("Nama pemesan minimal 3 karakter.", "contactName");
    if (!EVOA_EMAIL_RE.test(email)) return fail("Email pemesan tidak valid.", "email");
    if (!EVOA_PHONE_RE.test(phone)) return fail("Nomor telepon pemesan tidak valid.", "phone");
    if (!EVOA_PURPOSES.some((p) => p.value === purpose)) {
      return fail("Tujuan kedatangan tidak valid.", "purpose");
    }
    if (!isISODate(arrivalDate)) return fail("Tanggal kedatangan tidak valid.", "arrivalDate");
    // Today is allowed — the visa can be used the day it is issued.
    if (arrivalDate < todayISO()) {
      return fail("Tanggal kedatangan tidak boleh sudah lewat.", "arrivalDate");
    }
    // evoaArrivalTooEarly is a warning, not a block — the wizard shows it.
    if (!FLIGHT_RE.test(flightNumber)) {
      return fail("Nomor penerbangan kedatangan tidak valid (2–12 huruf/angka).", "flightNumber");
    }
    if (!portOfEntryId) return fail("Bandara kedatangan wajib dipilih.", "portOfEntryId");
    if (!hotelName) return fail("Nama hotel / akomodasi wajib diisi.", "hotelName");
    if (!hotelAddress) return fail("Alamat hotel / akomodasi wajib diisi.", "hotelAddress");
    if (!hotelCity) return fail("Kota hotel / akomodasi wajib diisi.", "hotelCity");
    if (departureDate) {
      if (!isISODate(departureDate)) return fail("Tanggal kepulangan tidak valid.", "departureDate");
      if (departureDate < arrivalDate) {
        return fail("Tanggal kepulangan tidak boleh sebelum kedatangan.", "departureDate");
      }
    }
    if (departureFlightNumber && !FLIGHT_RE.test(departureFlightNumber)) {
      return fail("Nomor penerbangan kepulangan tidak valid (2–12 huruf/angka).", "departureFlightNumber");
    }

    /* ---------------- reference data ---------------- */

    const [settings, countryRows, portRows, applicationDefs, applicantDefs] = await Promise.all([
      getEvoaSettings(),
      db.orm.public.Country
        .select("code")
        .where((f) => f.voaEligible.eq(true))
        .where((f) => f.active.eq(true))
        .all(),
      db.orm.public.Airport
        .select("id", "name", "kind", "active", "country")
        .where((f) => f.id.eq(portOfEntryId))
        .all(),
      listEvoaFieldDefs("application"),
      listEvoaFieldDefs("applicant"),
    ]);

    const eligibleCodes = new Set(countryRows.map((row) => row.code));
    const port = portRows[0];
    if (!port || port.kind !== "airport" || !port.active || port.country !== "Indonesia") {
      return fail("Bandara kedatangan tidak valid.", "portOfEntryId");
    }

    /* ---------------- applicants ---------------- */

    const rawApplicants = Array.isArray(input.applicants) ? input.applicants : [];
    if (rawApplicants.length < 1) return fail("Minimal satu pemohon visa.", "applicants");
    if (rawApplicants.length > settings.maxApplicants) {
      return fail(`Maksimal ${settings.maxApplicants} pemohon per pengajuan.`, "applicants");
    }

    const today = todayISO();
    const seenPassports = new Set<string>();
    const applicants: CleanApplicant[] = [];

    for (let i = 0; i < rawApplicants.length; i++) {
      const raw = (rawApplicants[i] ?? {}) as Partial<EvoaApplicantInput>;
      const at = (name: string) => `applicant:${i}:${name}`;
      const label = `Pemohon ${i + 1}`;

      const fullName = str(raw.fullName);
      const gender = str(raw.gender);
      const dateOfBirth = str(raw.dateOfBirth);
      const placeOfBirth = str(raw.placeOfBirth);
      const nationality = str(raw.nationality);
      const passportNumber = normalizePassportNumber(str(raw.passportNumber));
      const passportType = str(raw.passportType);
      const passportIssuingCountry = str(raw.passportIssuingCountry);
      const passportIssueDate = str(raw.passportIssueDate);
      const passportExpiryDate = str(raw.passportExpiryDate);
      const applicantEmail = str(raw.email).toLowerCase();
      const applicantPhone = str(raw.phone);
      const relation = str(raw.relation);

      if (fullName.length < 3) return fail(`${label}: nama lengkap minimal 3 karakter.`, at("fullName"));
      if (!EVOA_GENDERS.some((g) => g.value === gender)) {
        return fail(`${label}: jenis kelamin tidak valid.`, at("gender"));
      }
      if (!isISODate(dateOfBirth)) return fail(`${label}: tanggal lahir tidak valid.`, at("dateOfBirth"));
      if (dateOfBirth >= today) return fail(`${label}: tanggal lahir harus sudah lewat.`, at("dateOfBirth"));
      if (!placeOfBirth) return fail(`${label}: tempat lahir wajib diisi.`, at("placeOfBirth"));
      if (!eligibleCodes.has(nationality)) {
        return fail(`${label}: kewarganegaraan tidak memenuhi syarat e-VOA.`, at("nationality"));
      }
      if (!EVOA_PASSPORT_RE.test(passportNumber)) {
        return fail(`${label}: nomor paspor tidak valid (6–12 huruf/angka).`, at("passportNumber"));
      }
      if (seenPassports.has(passportNumber)) {
        return fail(`${label}: nomor paspor duplikat dalam satu pengajuan.`, at("passportNumber"));
      }
      seenPassports.add(passportNumber);
      if (!EVOA_PASSPORT_TYPES.some((t) => t.value === passportType)) {
        return fail(`${label}: jenis paspor tidak valid.`, at("passportType"));
      }
      if (!passportIssuingCountry) {
        return fail(`${label}: negara penerbit paspor wajib diisi.`, at("passportIssuingCountry"));
      }
      if (!isISODate(passportExpiryDate)) {
        return fail(`${label}: tanggal kedaluwarsa paspor tidak valid.`, at("passportExpiryDate"));
      }
      const validity = validatePassportValidity(passportExpiryDate, arrivalDate, passportType);
      if (!validity.ok) return fail(`${label}: ${validity.error}`, at("passportExpiryDate"));
      if (passportIssueDate) {
        if (!isISODate(passportIssueDate)) {
          return fail(`${label}: tanggal penerbitan paspor tidak valid.`, at("passportIssueDate"));
        }
        if (passportIssueDate > today) {
          return fail(`${label}: tanggal penerbitan paspor tidak boleh di masa depan.`, at("passportIssueDate"));
        }
      }
      if (!EVOA_EMAIL_RE.test(applicantEmail)) {
        return fail(`${label}: email tidak valid.`, at("email"));
      }
      if (!EVOA_PHONE_RE.test(applicantPhone)) {
        return fail(`${label}: nomor telepon tidak valid.`, at("phone"));
      }
      if (!EVOA_RELATIONS.some((r) => r.value === relation)) {
        return fail(`${label}: hubungan dengan pemesan tidak valid.`, at("relation"));
      }

      /* Documents — required slots, per-slot caps, reference integrity. */
      const rawDocs =
        raw.documents && typeof raw.documents === "object"
          ? (raw.documents as Record<string, unknown>)
          : {};
      const documents: Record<string, EvoaFileRef[]> = {};
      for (const [slot, refsRaw] of Object.entries(rawDocs)) {
        const rules = slotRules(slot, applicantDefs);
        if (!rules) return fail(`${label}: slot dokumen tidak dikenal.`, at(`doc:${slot}`));
        const checked = checkRefs(refsRaw, rules, slot);
        if (!checked.ok) return fail(`${label}: ${checked.error}`, at(`doc:${slot}`));
        if (checked.refs.length > 0) documents[slot] = checked.refs;
      }
      for (const slotDef of EVOA_DOC_SLOTS) {
        if (slotDef.required && !(documents[slotDef.slot]?.length)) {
          return fail(`${label}: dokumen "${slotDef.id}" wajib diunggah.`, at(`doc:${slotDef.slot}`));
        }
      }

      /* Dynamic applicant answers (file fields included). */
      const extraAnswers = sanitizeAnswers(applicantDefs, raw.extraAnswers);
      const answersCheck = await validateScopeAnswers("applicant", extraAnswers, { purpose });
      if (!answersCheck.ok) {
        return fail(`${label}: ${answersCheck.error}`, at(`field:${answersCheck.fieldKey}`));
      }
      // The shared validator checks required/maxFiles/key+url; enforce the
      // bucket prefix and type/size caps on the file references too.
      for (const def of applicantDefs) {
        if (def.type !== "file") continue;
        const refs = extraAnswers[def.key];
        if (!Array.isArray(refs) || refs.length === 0) continue;
        const checked = checkRefs(
          refs,
          { maxFiles: def.maxFiles ?? 1, accept: DYNAMIC_FILE_ACCEPT, maxBytes: DYNAMIC_FILE_MAX_BYTES },
          def.labelId ?? def.labelEn,
        );
        if (!checked.ok) return fail(`${label}: ${checked.error}`, at(`field:${def.key}`));
        extraAnswers[def.key] = checked.refs;
      }

      applicants.push({
        fullName,
        gender,
        dateOfBirth: new Date(`${dateOfBirth}T00:00:00Z`),
        placeOfBirth,
        nationality,
        passportNumber,
        passportType,
        passportIssuingCountry,
        passportIssueDate: passportIssueDate ? new Date(`${passportIssueDate}T00:00:00Z`) : null,
        passportExpiryDate: new Date(`${passportExpiryDate}T00:00:00Z`),
        email: applicantEmail,
        phone: applicantPhone,
        relation,
        extraAnswers,
        documents,
      });
    }

    /* ---------------- order-level dynamic answers ---------------- */

    const orderAnswers = sanitizeAnswers(applicationDefs, input.extraAnswers);
    const orderCheck = await validateScopeAnswers("application", orderAnswers, { purpose });
    if (!orderCheck.ok) return fail(orderCheck.error, `field:${orderCheck.fieldKey}`);
    for (const def of applicationDefs) {
      if (def.type !== "file") continue;
      const refs = orderAnswers[def.key];
      if (!Array.isArray(refs) || refs.length === 0) continue;
      const checked = checkRefs(
        refs,
        { maxFiles: def.maxFiles ?? 1, accept: DYNAMIC_FILE_ACCEPT, maxBytes: DYNAMIC_FILE_MAX_BYTES },
        def.labelId ?? def.labelEn,
      );
      if (!checked.ok) return fail(checked.error, `field:${def.key}`);
      orderAnswers[def.key] = checked.refs;
    }

    /* ---------------- persistence ---------------- */

    const applicationId = crypto.randomUUID();
    // The code is random — retry a few times on the (unlikely) collision.
    let code = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = generateApplicationCode();
      const existing = await db.orm.public.VisaApplication
        .select("id")
        .where((f) => f.code.eq(candidate))
        .first();
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) return fail("Nomor pengajuan tidak bisa dibuat. Coba lagi.");

    const arrival = new Date(`${arrivalDate}T00:00:00Z`);

    await db.orm.public.VisaApplication.create({
      id: applicationId,
      code,
      userId: session.uid,
      status: "draft",
      contactName,
      email,
      phone,
      purpose,
      arrivalDate: arrival,
      flightNumber,
      portOfEntryId: port.id,
      portOfEntryName: port.name,
      departureDate: departureDate ? new Date(`${departureDate}T00:00:00Z`) : null,
      departureFlightNumber: departureFlightNumber || null,
      hotelName,
      hotelAddress,
      hotelCity,
      hotelPostalCode: hotelPostalCode || null,
      extraAnswers: orderAnswers as never,
      note: note || null,
      totalUsdCents: 0,
    });

    for (let i = 0; i < applicants.length; i++) {
      const applicant = applicants[i]!;
      const applicantId = crypto.randomUUID();
      await db.orm.public.VisaApplicant.create({
        id: applicantId,
        applicationId,
        sortOrder: i,
        fullName: applicant.fullName,
        gender: applicant.gender,
        dateOfBirth: applicant.dateOfBirth,
        placeOfBirth: applicant.placeOfBirth,
        nationality: applicant.nationality,
        passportNumber: applicant.passportNumber,
        passportType: applicant.passportType,
        passportIssuingCountry: applicant.passportIssuingCountry,
        passportIssueDate: applicant.passportIssueDate,
        passportExpiryDate: applicant.passportExpiryDate,
        email: applicant.email,
        phone: applicant.phone,
        relation: applicant.relation,
        extraAnswers: applicant.extraAnswers as never,
        status: "pending",
      });

      // Standard slots + dynamic file fields (the field key is the slot).
      for (const [slot, refs] of Object.entries(applicant.documents)) {
        await createDocumentRows(applicationId, applicantId, slot, refs);
      }
      for (const def of applicantDefs) {
        if (def.type !== "file") continue;
        const refs = applicant.extraAnswers[def.key];
        if (Array.isArray(refs) && refs.length > 0) {
          await createDocumentRows(applicationId, applicantId, def.key, refs);
        }
      }
    }

    // Order-level file answers become applicant-less document rows.
    for (const def of applicationDefs) {
      if (def.type !== "file") continue;
      const refs = orderAnswers[def.key];
      if (Array.isArray(refs) && refs.length > 0) {
        await createDocumentRows(applicationId, null, def.key, refs);
      }
    }

    await recordEvent({ applicationId, status: "draft", actorEmail: session.email });

    /* ---------------- booking + payment hand-off ---------------- */

    const quote = await quoteEvoa(applicants.length);
    const booking = await createEvoaBooking({
      applicationId,
      applicationCode: code,
      userId: session.uid,
      contactName,
      email,
      phone,
      arrivalDate: arrival,
      applicantNames: applicants.map((a) => a.fullName),
      quote,
      idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined,
    });
    if (!booking.ok) {
      // The draft survives — the customer can retry without re-entering data.
      return fail(booking.error);
    }

    await db.orm.public.VisaApplication
      .where((f) => f.id.eq(applicationId))
      .update({ status: "awaiting_payment", totalUsdCents: quote.totalUsdCents });
    await recordEvent({ applicationId, status: "awaiting_payment", actorEmail: session.email });

    return {
      ok: true,
      data: { code, bookingCode: booking.bookingCode, totalUsdCents: quote.totalUsdCents },
    };
  } catch (error) {
    console.error("[evoa] could not submit the application", error);
    return fail("Pengajuan tidak bisa disimpan. Coba lagi sebentar.");
  }
}

/* ------------------------------------------------------------------ */
/* Revision resubmission                                               */
/* ------------------------------------------------------------------ */

export type EvoaRevisionPayload = {
  applicantUpdates?: { applicantId: string; documents: Record<string, EvoaFileRef[]> }[];
  orderDocuments?: Record<string, EvoaFileRef[]>;
  note?: string;
};

/**
 * Resubmit the documents ops asked to revise. Only the owner of an order in
 * "revision" may call this. Each provided slot replaces the previous files
 * (row delete + best-effort R2 cleanup, then fresh rows); an applicant whose
 * documents were replaced moves "revision" → "review", and once no applicant
 * remains in revision the whole order returns to "review".
 *
 * The tracking page calls this exact signature.
 */
export async function resubmitEvoaRevision(
  code: string,
  payload: EvoaRevisionPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getUserSession();
  if (!session) return fail("Sesi tidak valid. Silakan masuk kembali.");

  try {
    const orderCode = str(code);
    if (!orderCode) return fail("Nomor pengajuan tidak valid.");

    const order = await db.orm.public.VisaApplication
      .select("id", "code", "userId", "status")
      .where((f) => f.code.eq(orderCode))
      .first();
    // Ownership: guest orders (userId null) never match a signed-in uid.
    if (!order || order.userId !== session.uid) return fail("Pengajuan tidak ditemukan.");
    if (order.status !== "revision") {
      return fail("Pengajuan ini tidak sedang menunggu revisi.");
    }

    const applicantRows = await db.orm.public.VisaApplicant
      .select("id", "status")
      .where((f) => f.applicationId.eq(order.id))
      .all();
    const applicantStatus = new Map(applicantRows.map((row) => [row.id, row.status]));

    const [applicationDefs, applicantDefs] = await Promise.all([
      listEvoaFieldDefs("application"),
      listEvoaFieldDefs("applicant"),
    ]);

    const applicantUpdates = Array.isArray(payload.applicantUpdates) ? payload.applicantUpdates : [];
    const orderDocuments =
      payload.orderDocuments && typeof payload.orderDocuments === "object"
        ? payload.orderDocuments
        : {};
    const note = typeof payload.note === "string" ? payload.note.trim() : undefined;

    const hasDocs =
      applicantUpdates.some((u) => u && Object.keys(u.documents ?? {}).length > 0) ||
      Object.keys(orderDocuments).length > 0;
    if (!hasDocs && note === undefined) return fail("Tidak ada perubahan yang dikirim.");

    /* Validate everything before writing — a bad reference must not leave
     * the order half-revised. */
    const checkedUpdates: { applicantId: string; slots: { slot: string; refs: EvoaFileRef[] }[] }[] = [];
    for (const update of applicantUpdates) {
      if (!update || typeof update.applicantId !== "string") continue;
      if (!applicantStatus.has(update.applicantId)) return fail("Pemohon tidak ditemukan.");
      const slots: { slot: string; refs: EvoaFileRef[] }[] = [];
      const docs = update.documents && typeof update.documents === "object" ? update.documents : {};
      for (const [slot, refsRaw] of Object.entries(docs)) {
        const rules = slotRules(slot, applicantDefs);
        if (!rules) return fail("Slot dokumen tidak dikenal.");
        const checked = checkRefs(refsRaw, rules, slot);
        if (!checked.ok) return fail(checked.error);
        slots.push({ slot, refs: checked.refs });
      }
      checkedUpdates.push({ applicantId: update.applicantId, slots });
    }

    const checkedOrderSlots: { slot: string; refs: EvoaFileRef[] }[] = [];
    for (const [slot, refsRaw] of Object.entries(orderDocuments)) {
      // Order-level documents only exist for application-scope file fields.
      const def = applicationDefs.find((d) => d.key === slot && d.type === "file");
      if (!def) return fail("Slot dokumen tingkat pesanan tidak dikenal.");
      const checked = checkRefs(
        refsRaw,
        { maxFiles: def.maxFiles ?? 1, accept: DYNAMIC_FILE_ACCEPT, maxBytes: DYNAMIC_FILE_MAX_BYTES },
        def.labelId ?? def.labelEn,
      );
      if (!checked.ok) return fail(checked.error);
      checkedOrderSlots.push({ slot, refs: checked.refs });
    }

    /* Replace the documents slot by slot. deleteDocumentRow removes the row
     * first and the R2 object best-effort, so a storage hiccup never blocks
     * the resubmission. */
    for (const update of checkedUpdates) {
      for (const { slot, refs } of update.slots) {
        const existing = await db.orm.public.VisaDocument
          .select("id")
          .where((f) => f.applicationId.eq(order.id))
          .where((f) => f.applicantId.eq(update.applicantId))
          .where((f) => f.slot.eq(slot))
          .all();
        for (const row of existing) await deleteDocumentRow(row.id);
        await createDocumentRows(order.id, update.applicantId, slot, refs);
      }
      // Only a revision applicant flips — untouched statuses stay as they are.
      if (applicantStatus.get(update.applicantId) === "revision" && update.slots.length > 0) {
        await db.orm.public.VisaApplicant
          .where((f) => f.id.eq(update.applicantId))
          .update({ status: "review", revisionNote: null });
        applicantStatus.set(update.applicantId, "review");
        await recordEvent({
          applicationId: order.id,
          applicantId: update.applicantId,
          status: "review",
          note: "Dokumen revisi dikirim ulang.",
          actorEmail: session.email,
        });
      }
    }

    for (const { slot, refs } of checkedOrderSlots) {
      const existing = await db.orm.public.VisaDocument
        .select("id")
        .where((f) => f.applicationId.eq(order.id))
        .where((f) => f.applicantId.isNull())
        .where((f) => f.slot.eq(slot))
        .all();
      for (const row of existing) await deleteDocumentRow(row.id);
      await createDocumentRows(order.id, null, slot, refs);
    }

    /* Once nobody remains in revision the order goes back to review. This
     * also covers order-level revisions (no applicant flagged). */
    const stillRevision = [...applicantStatus.values()].some((status) => status === "revision");
    const nextStatus = stillRevision ? "revision" : "review";

    const orderUpdate: { status: string; revisionNote?: null; note?: string | null } = {
      status: nextStatus,
    };
    if (!stillRevision) orderUpdate.revisionNote = null;
    if (note !== undefined) orderUpdate.note = note || null;
    await db.orm.public.VisaApplication.where((f) => f.id.eq(order.id)).update(orderUpdate);
    await recordEvent({
      applicationId: order.id,
      status: nextStatus,
      note: note || (stillRevision ? "Sebagian dokumen revisi dikirim ulang." : "Semua dokumen revisi dikirim ulang."),
      actorEmail: session.email,
    });

    return { ok: true };
  } catch (error) {
    console.error("[evoa] could not resubmit the revision", error);
    return fail("Revisi tidak bisa dikirim. Coba lagi sebentar.");
  }
}
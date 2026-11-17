// Shared types + helpers of the e-VOA wizard steps.
//
// The client validation here MIRRORS the server rules in
// src/app/actions/evoa.ts (same regexes, same limits, same field keys) so an
// error found on either side lands on the same input. The server remains the
// authority — these checks only save a round-trip.

import {
  EVOA_DOC_SLOTS,
  EVOA_EMAIL_RE,
  EVOA_GENDERS,
  EVOA_PASSPORT_RE,
  EVOA_PASSPORT_TYPES,
  EVOA_PHONE_RE,
  EVOA_PURPOSES,
  EVOA_RELATIONS,
  normalizePassportNumber,
  validateEvoaAnswers,
  validatePassportValidity,
  type EvoaAnswers,
  type EvoaFileRef,
} from "@/lib/evoa-shared";
import { formatMoneyWith } from "@/lib/currency";
import type { EvoaFormData } from "@/app/actions/evoa";

export type Lang = "en" | "id";

/** Same input styling as the rest of the e-VOA form. */
export const FIELD_CLASS =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

export const AREA_CLASS =
  "w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-ink outline-none transition-colors focus:border-brand";

/** Red border variant applied to the field a validation error points at. */
export function fieldClass(base: string, errored: boolean): string {
  return errored ? `${base} border-danger focus:border-danger` : base;
}

export type FieldError = { field: string; error: string } | null;

/* ------------------------------------------------------------------ */
/* Form state shapes                                                   */
/* ------------------------------------------------------------------ */

export type TravelForm = {
  contactName: string;
  email: string;
  phone: string;
  purpose: string;
  arrivalDate: string;
  flightNumber: string;
  portOfEntryId: string;
  departureDate: string;
  departureFlightNumber: string;
  hotelName: string;
  hotelAddress: string;
  hotelCity: string;
  hotelPostalCode: string;
};

export function emptyTravel(): TravelForm {
  return {
    contactName: "",
    email: "",
    phone: "",
    purpose: "tourism",
    arrivalDate: "",
    flightNumber: "",
    portOfEntryId: "",
    departureDate: "",
    departureFlightNumber: "",
    hotelName: "",
    hotelAddress: "",
    hotelCity: "",
    hotelPostalCode: "",
  };
}

export type ApplicantForm = {
  /** Stable local key (React list identity) — never sent to the server. */
  key: string;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  placeOfBirth: string;
  nationality: string;
  relation: string;
  passportNumber: string;
  passportType: string;
  passportIssuingCountry: string;
  passportIssueDate: string;
  passportExpiryDate: string;
  email: string;
  phone: string;
  extraAnswers: EvoaAnswers;
  documents: Record<string, EvoaFileRef[]>;
};

export function newApplicant(): ApplicantForm {
  return {
    key: crypto.randomUUID(),
    fullName: "",
    gender: "",
    dateOfBirth: "",
    placeOfBirth: "",
    nationality: "",
    relation: "self",
    passportNumber: "",
    passportType: "ordinary",
    passportIssuingCountry: "",
    passportIssueDate: "",
    passportExpiryDate: "",
    email: "",
    phone: "",
    extraAnswers: {},
    documents: {},
  };
}

/* ------------------------------------------------------------------ */
/* Field keys — identical to the server action's `field` values        */
/* ------------------------------------------------------------------ */

export const applicantField = (index: number, name: string) => `applicant:${index}:${name}`;
export const applicantDocField = (index: number, slot: string) => `applicant:${index}:doc:${slot}`;
export const applicantDynamicField = (index: number, key: string) => `applicant:${index}:field:${key}`;
export const orderDynamicField = (key: string) => `field:${key}`;

/** Which wizard step (0-based) a server/client field error belongs to. */
export function stepForField(field: string | undefined): number {
  if (!field) return 0;
  if (field.startsWith("applicant:")) return 1;
  if (field.startsWith("field:")) return 2;
  return 0;
}

/** The applicant index an `applicant:<i>:…` field key points at. */
export function applicantIndexForField(field: string | undefined): number | null {
  if (!field || !field.startsWith("applicant:")) return null;
  const index = Number(field.split(":")[1]);
  return Number.isInteger(index) ? index : null;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** USD cents → "$15.00" (the app-wide formatter takes dollars). */
export function usd(cents: number): string {
  return formatMoneyWith(cents / 100);
}

/** IDR estimate for display — the charge itself is settled by Xendit. */
export function idr(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function formatDate(iso: string, lang: Lang): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/* ------------------------------------------------------------------ */
/* Date helpers (mirror the server)                                    */
/* ------------------------------------------------------------------ */

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return false;
  return new Date(time).toISOString().slice(0, 10) === value;
}

const FLIGHT_RE = /^[A-Z0-9]{2,12}$/;

/* ------------------------------------------------------------------ */
/* Client validation — Indonesian/English, same rules as the server    */
/* ------------------------------------------------------------------ */

export function validateTravel(
  travel: TravelForm,
  data: EvoaFormData,
  lang: Lang,
): FieldError {
  const t = (en: string, id: string) => (lang === "id" ? id : en);

  if (travel.contactName.trim().length < 3) {
    return { field: "contactName", error: t("Booker name must be at least 3 characters.", "Nama pemesan minimal 3 karakter.") };
  }
  if (!EVOA_EMAIL_RE.test(travel.email.trim())) {
    return { field: "email", error: t("Invalid email address.", "Email pemesan tidak valid.") };
  }
  if (!EVOA_PHONE_RE.test(travel.phone.trim())) {
    return { field: "phone", error: t("Invalid phone number.", "Nomor telepon pemesan tidak valid.") };
  }
  if (!EVOA_PURPOSES.some((p) => p.value === travel.purpose)) {
    return { field: "purpose", error: t("Choose a purpose of visit.", "Tujuan kedatangan tidak valid.") };
  }
  if (!isISODate(travel.arrivalDate)) {
    return { field: "arrivalDate", error: t("Enter a valid arrival date.", "Tanggal kedatangan tidak valid.") };
  }
  if (travel.arrivalDate < todayISO()) {
    return { field: "arrivalDate", error: t("Arrival date cannot be in the past.", "Tanggal kedatangan tidak boleh sudah lewat.") };
  }
  if (!FLIGHT_RE.test(travel.flightNumber.trim().toUpperCase())) {
    return { field: "flightNumber", error: t("Arrival flight number: 2–12 letters/digits.", "Nomor penerbangan kedatangan tidak valid (2–12 huruf/angka).") };
  }
  if (!data.airports.some((a) => a.id === travel.portOfEntryId)) {
    return { field: "portOfEntryId", error: t("Choose the arrival airport.", "Bandara kedatangan wajib dipilih.") };
  }
  if (!travel.hotelName.trim()) {
    return { field: "hotelName", error: t("Accommodation name is required.", "Nama hotel / akomodasi wajib diisi.") };
  }
  if (!travel.hotelAddress.trim()) {
    return { field: "hotelAddress", error: t("Accommodation address is required.", "Alamat hotel / akomodasi wajib diisi.") };
  }
  if (!travel.hotelCity.trim()) {
    return { field: "hotelCity", error: t("Accommodation city is required.", "Kota hotel / akomodasi wajib diisi.") };
  }
  if (travel.departureDate) {
    if (!isISODate(travel.departureDate)) {
      return { field: "departureDate", error: t("Enter a valid departure date.", "Tanggal kepulangan tidak valid.") };
    }
    if (travel.departureDate < travel.arrivalDate) {
      return { field: "departureDate", error: t("Departure cannot be before arrival.", "Tanggal kepulangan tidak boleh sebelum kedatangan.") };
    }
  }
  if (travel.departureFlightNumber && !FLIGHT_RE.test(travel.departureFlightNumber.trim().toUpperCase())) {
    return { field: "departureFlightNumber", error: t("Departure flight number: 2–12 letters/digits.", "Nomor penerbangan kepulangan tidak valid (2–12 huruf/angka).") };
  }
  return null;
}

export function validateApplicant(
  applicant: ApplicantForm,
  index: number,
  travel: TravelForm,
  data: EvoaFormData,
  lang: Lang,
): FieldError {
  const t = (en: string, id: string) => (lang === "id" ? id : en);
  const label = t(`Applicant ${index + 1}`, `Pemohon ${index + 1}`);
  const err = (name: string, message: string): FieldError => ({
    field: applicantField(index, name),
    error: `${label}: ${message}`,
  });

  if (applicant.fullName.trim().length < 3) {
    return err("fullName", t("Full name must be at least 3 characters.", "nama lengkap minimal 3 karakter."));
  }
  if (!EVOA_GENDERS.some((g) => g.value === applicant.gender)) {
    return err("gender", t("Choose a gender.", "jenis kelamin tidak valid."));
  }
  if (!isISODate(applicant.dateOfBirth)) {
    return err("dateOfBirth", t("Enter a valid date of birth.", "tanggal lahir tidak valid."));
  }
  if (applicant.dateOfBirth >= todayISO()) {
    return err("dateOfBirth", t("Date of birth must be in the past.", "tanggal lahir harus sudah lewat."));
  }
  if (!applicant.placeOfBirth.trim()) {
    return err("placeOfBirth", t("Place of birth is required.", "tempat lahir wajib diisi."));
  }
  if (!data.countries.some((c) => c.code === applicant.nationality)) {
    return err("nationality", t("Nationality is not e-VOA eligible.", "kewarganegaraan tidak memenuhi syarat e-VOA."));
  }
  if (!EVOA_PASSPORT_RE.test(normalizePassportNumber(applicant.passportNumber))) {
    return err("passportNumber", t("Passport number: 6–12 letters/digits.", "nomor paspor tidak valid (6–12 huruf/angka)."));
  }
  if (!EVOA_PASSPORT_TYPES.some((p) => p.value === applicant.passportType)) {
    return err("passportType", t("Choose a passport type.", "jenis paspor tidak valid."));
  }
  if (!applicant.passportIssuingCountry.trim()) {
    return err("passportIssuingCountry", t("Issuing country is required.", "negara penerbit paspor wajib diisi."));
  }
  if (!isISODate(applicant.passportExpiryDate)) {
    return err("passportExpiryDate", t("Enter a valid passport expiry date.", "tanggal kedaluwarsa paspor tidak valid."));
  }
  const validity = validatePassportValidity(
    applicant.passportExpiryDate,
    travel.arrivalDate,
    applicant.passportType,
  );
  if (!validity.ok) return err("passportExpiryDate", validity.error);
  if (applicant.passportIssueDate) {
    if (!isISODate(applicant.passportIssueDate)) {
      return err("passportIssueDate", t("Enter a valid issue date.", "tanggal penerbitan paspor tidak valid."));
    }
    if (applicant.passportIssueDate > todayISO()) {
      return err("passportIssueDate", t("Issue date cannot be in the future.", "tanggal penerbitan paspor tidak boleh di masa depan."));
    }
  }
  if (!EVOA_EMAIL_RE.test(applicant.email.trim())) {
    return err("email", t("Invalid email address.", "email tidak valid."));
  }
  if (!EVOA_PHONE_RE.test(applicant.phone.trim())) {
    return err("phone", t("Invalid phone number.", "nomor telepon tidak valid."));
  }
  if (!EVOA_RELATIONS.some((r) => r.value === applicant.relation)) {
    return err("relation", t("Choose the relation to the booker.", "hubungan dengan pemesan tidak valid."));
  }

  // Required document slots.
  for (const slot of EVOA_DOC_SLOTS) {
    const files = applicant.documents[slot.slot] ?? [];
    if (slot.required && files.length === 0) {
      return {
        field: applicantDocField(index, slot.slot),
        error: `${label}: ${t(`"${slot.en}" is required.`, `dokumen "${slot.id}" wajib diunggah.`)}`,
      };
    }
    if (files.length > slot.maxFiles) {
      return {
        field: applicantDocField(index, slot.slot),
        error: `${label}: ${t(`Maximum ${slot.maxFiles} file(s).`, `maksimal ${slot.maxFiles} file.`)}`,
      };
    }
  }

  // Dynamic applicant fields (visibility depends on purpose + other answers).
  const answersCheck = validateEvoaAnswers(
    data.fieldDefs.applicant,
    applicant.extraAnswers,
    { purpose: travel.purpose, answers: applicant.extraAnswers },
    lang,
  );
  if (!answersCheck.ok) {
    return {
      field: applicantDynamicField(index, answersCheck.fieldKey),
      error: `${label}: ${answersCheck.error}`,
    };
  }
  return null;
}

/** Duplicate passport numbers within the order (checked after per-card rules). */
export function findDuplicatePassport(
  applicants: ApplicantForm[],
  lang: Lang,
): FieldError {
  const seen = new Map<string, number>();
  for (let i = 0; i < applicants.length; i++) {
    const number = normalizePassportNumber(applicants[i]!.passportNumber);
    if (!EVOA_PASSPORT_RE.test(number)) continue; // per-card check reports it
    const first = seen.get(number);
    if (first !== undefined) {
      return {
        field: applicantField(i, "passportNumber"),
        error:
          lang === "id"
            ? `Pemohon ${i + 1}: nomor paspor duplikat dalam satu pengajuan.`
            : `Applicant ${i + 1}: duplicate passport number in this order.`,
      };
    }
    seen.set(number, i);
  }
  return null;
}

export function validateOrderAnswers(
  data: EvoaFormData,
  answers: EvoaAnswers,
  purpose: string,
  lang: Lang,
): FieldError {
  const check = validateEvoaAnswers(
    data.fieldDefs.application,
    answers,
    { purpose, answers },
    lang,
  );
  if (!check.ok) return { field: orderDynamicField(check.fieldKey), error: check.error };
  return null;
}

/** All required document slots present? (card header badge) */
export function docsComplete(applicant: ApplicantForm): boolean {
  return EVOA_DOC_SLOTS.filter((s) => s.required).every(
    (s) => (applicant.documents[s.slot]?.length ?? 0) > 0,
  );
}

/** Total uploaded files of one applicant (standard slots + dynamic files). */
export function docCount(applicant: ApplicantForm, data: EvoaFormData): number {
  let count = Object.values(applicant.documents).reduce((sum, refs) => sum + refs.length, 0);
  for (const def of data.fieldDefs.applicant) {
    if (def.type !== "file") continue;
    const value = applicant.extraAnswers[def.key];
    if (Array.isArray(value)) count += value.length;
  }
  return count;
}
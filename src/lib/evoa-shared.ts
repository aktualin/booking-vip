// Shared e-VOA contract — isomorphic (client + server).
//
// Single source of truth for the e-VOA service: statuses, purposes, document
// slots, dynamic-field shapes and the pure validation rules. Server actions,
// the customer wizard and the admin panel all import from here; nobody
// re-declares these constants.
//
// The service: the customer hands us the passport data of 1..5 people and we
// apply for the Indonesian e-VOA (B1) on the official portal on their behalf.

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/** The official portal allows up to 5 people per application. */
export const EVOA_MAX_APPLICANTS = 5;

/** e-VOA is valid 90 days from issue — warn when arrival is further out. */
export const EVOA_ARRIVAL_WARN_DAYS = 80;

/** Ordinary passports need 6 months validity from arrival; emergency 12. */
export const EVOA_MIN_VALIDITY_MONTHS = 6;
export const EVOA_EMERGENCY_MIN_VALIDITY_MONTHS = 12;

/* ------------------------------------------------------------------ */
/* Statuses                                                            */
/* ------------------------------------------------------------------ */

/** Order-level workflow (VisaApplication.status). */
export const EVOA_ORDER_STATUSES = [
  "draft",
  "awaiting_payment",
  "paid",
  "review",
  "revision",
  "processing",
  "issued",
  "completed",
  "rejected",
  "refunded",
  "expired",
] as const;
export type EvoaOrderStatus = (typeof EVOA_ORDER_STATUSES)[number];

/** Legacy rows (pre-group model) may still carry these. */
export const EVOA_LEGACY_STATUSES = ["submitted", "approved"] as const;

/** Applicant-level workflow (VisaApplicant.status). */
export const EVOA_APPLICANT_STATUSES = [
  "pending",
  "review",
  "revision",
  "processing",
  "issued",
  "rejected",
] as const;
export type EvoaApplicantStatus = (typeof EVOA_APPLICANT_STATUSES)[number];

export const EVOA_STATUS_LABELS: Record<string, { en: string; id: string }> = {
  draft: { en: "Draft", id: "Draf" },
  awaiting_payment: { en: "Awaiting payment", id: "Menunggu pembayaran" },
  paid: { en: "Paid", id: "Dibayar" },
  review: { en: "Document review", id: "Verifikasi dokumen" },
  revision: { en: "Revision requested", id: "Perlu revisi" },
  processing: { en: "Being processed", id: "Sedang diproses" },
  issued: { en: "e-VOA issued", id: "e-VOA terbit" },
  completed: { en: "Completed", id: "Selesai" },
  rejected: { en: "Rejected", id: "Ditolak" },
  refunded: { en: "Refunded", id: "Dana dikembalikan" },
  expired: { en: "Expired", id: "Kedaluwarsa" },
  submitted: { en: "Submitted", id: "Terkirim" },
  approved: { en: "Approved", id: "Disetujui" },
  pending: { en: "Pending", id: "Menunggu" },
};

/** Timeline order used by the tracking page (legacy statuses map in). */
export const EVOA_STATUS_FLOW: EvoaOrderStatus[] = [
  "awaiting_payment",
  "paid",
  "review",
  "processing",
  "issued",
  "completed",
];

/* ------------------------------------------------------------------ */
/* Purposes, relations, genders                                        */
/* ------------------------------------------------------------------ */

export const EVOA_PURPOSES = [
  { value: "tourism", en: "Tourism", id: "Wisata" },
  { value: "family_social", en: "Family / social visit", id: "Kunjungan keluarga / sosial" },
  { value: "government", en: "Government duty", id: "Tugas pemerintah" },
  { value: "business_meeting", en: "Business meeting", id: "Pembicaraan bisnis" },
  { value: "goods_purchase", en: "Goods purchase", id: "Pembelian barang" },
  { value: "transit", en: "Transit", id: "Transit" },
] as const;
export type EvoaPurpose = (typeof EVOA_PURPOSES)[number]["value"];

export const EVOA_RELATIONS = [
  { value: "self", en: "Myself", id: "Diri sendiri" },
  { value: "family", en: "Family", id: "Keluarga" },
  { value: "client", en: "Client", id: "Klien" },
  { value: "other", en: "Other", id: "Lainnya" },
] as const;

export const EVOA_GENDERS = [
  { value: "male", en: "Male", id: "Laki-laki" },
  { value: "female", en: "Female", id: "Perempuan" },
] as const;

export const EVOA_PASSPORT_TYPES = [
  { value: "ordinary", en: "Ordinary passport", id: "Paspor biasa" },
  { value: "emergency", en: "Emergency / temporary passport", id: "Paspor darurat / sementara" },
] as const;

/* ------------------------------------------------------------------ */
/* Document slots                                                      */
/* ------------------------------------------------------------------ */

export type EvoaDocSlotDef = {
  slot: string;
  required: boolean;
  /** MIME types accepted by the upload route. */
  accept: string[];
  maxFiles: number;
  maxBytes: number;
  en: string;
  id: string;
  helpEn: string;
  helpId: string;
};

const MB = 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOC_TYPES = [...IMAGE_TYPES, "application/pdf"];

/** The standard documents — mirrors the official e-VOA requirements. */
export const EVOA_DOC_SLOTS: EvoaDocSlotDef[] = [
  {
    slot: "passport",
    required: true,
    accept: DOC_TYPES,
    maxFiles: 3,
    maxBytes: 8 * MB,
    en: "Passport biodata page",
    id: "Halaman biodata paspor",
    helpEn: "The photo page of the passport. JPG, PNG, WEBP or PDF, max 8 MB.",
    helpId: "Halaman foto paspor. JPG, PNG, WEBP, atau PDF, maks 8 MB.",
  },
  {
    slot: "photo",
    required: true,
    accept: IMAGE_TYPES,
    maxFiles: 2,
    maxBytes: 8 * MB,
    en: "Passport photo",
    id: "Pas foto",
    helpEn: "Recent colour photo, plain background, no sunglasses. JPG/PNG/WEBP.",
    helpId: "Foto berwarna terbaru, latar polos, tanpa kacamata hitam. JPG/PNG/WEBP.",
  },
  {
    slot: "ticket",
    required: true,
    accept: DOC_TYPES,
    maxFiles: 10,
    maxBytes: 8 * MB,
    en: "Return / onward ticket",
    id: "Tiket pulang / terusan",
    helpEn: "Flight out of Indonesia. Several files allowed (multi-page itineraries).",
    helpId: "Tiket keluar dari Indonesia. Bisa beberapa file (itinerary banyak halaman).",
  },
  {
    slot: "hotel",
    required: false,
    accept: DOC_TYPES,
    maxFiles: 10,
    maxBytes: 8 * MB,
    en: "Accommodation booking (optional)",
    id: "Booking akomodasi (opsional)",
    helpEn: "Hotel / stay confirmation in Indonesia. Several files allowed.",
    helpId: "Konfirmasi hotel / tempat tinggal di Indonesia. Bisa beberapa file.",
  },
];

export function evoaDocSlot(slot: string): EvoaDocSlotDef | undefined {
  return EVOA_DOC_SLOTS.find((s) => s.slot === slot);
}

/* ------------------------------------------------------------------ */
/* Dynamic fields (EvoaFormField)                                      */
/* ------------------------------------------------------------------ */

export const EVOA_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
  "file",
] as const;
export type EvoaFieldType = (typeof EVOA_FIELD_TYPES)[number];

export const EVOA_FIELD_SCOPES = ["application", "applicant"] as const;
export type EvoaFieldScope = (typeof EVOA_FIELD_SCOPES)[number];

/** Conditional visibility rule stored in EvoaFormField.showWhen. */
export type EvoaShowWhen = {
  /** "purpose" or the key of another field (same scope). */
  field: string;
  equals: string;
};

export type EvoaFieldOption = { value: string; labelEn: string; labelId?: string };

/** Client-facing definition of one dynamic field. */
export type EvoaFieldDefDTO = {
  id: string;
  key: string;
  labelEn: string;
  labelId: string | null;
  type: EvoaFieldType;
  scope: EvoaFieldScope;
  required: boolean;
  options: EvoaFieldOption[];
  showWhen: EvoaShowWhen | null;
  placeholderEn: string | null;
  placeholderId: string | null;
  helpEn: string | null;
  helpId: string | null;
  maxFiles: number | null;
  sortOrder: number;
};

/** An already-uploaded file referenced by a "file" field answer. */
export type EvoaFileRef = {
  key: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/** Answers map: field key → string | boolean | EvoaFileRef[]. */
export type EvoaAnswers = Record<string, string | boolean | EvoaFileRef[]>;

/** Context a showWhen rule evaluates against. */
export type EvoaFieldContext = {
  purpose?: string;
  /** Other answers in the same scope (for field-to-field rules). */
  answers?: EvoaAnswers;
};

export function evoaFieldVisible(
  showWhen: EvoaShowWhen | null | undefined,
  ctx: EvoaFieldContext,
): boolean {
  if (!showWhen || !showWhen.field) return true;
  const actual =
    showWhen.field === "purpose"
      ? ctx.purpose
      : ctx.answers?.[showWhen.field];
  return String(actual ?? "") === showWhen.equals;
}

/** Validate one answer against its definition. Returns an error message key
 * or null. `lang` selects the message language. Pure — client + server. */
export function validateEvoaAnswer(
  def: Pick<EvoaFieldDefDTO, "key" | "type" | "required" | "options" | "maxFiles">,
  value: unknown,
  lang: "en" | "id" = "id",
): string | null {
  const t = (en: string, id: string) => (lang === "id" ? id : en);
  const empty =
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  if (def.type === "checkbox") {
    if (def.required && value !== true) {
      return t("This box must be checked.", "Kotak ini wajib dicentang.");
    }
    return null;
  }

  if (def.type === "file") {
    const files = Array.isArray(value) ? value : [];
    if (def.required && files.length === 0) {
      return t("A file is required.", "File wajib diunggah.");
    }
    const max = def.maxFiles ?? 1;
    if (files.length > max) {
      return t(`Maximum ${max} file(s).`, `Maksimal ${max} file.`);
    }
    for (const f of files) {
      const ref = f as Partial<EvoaFileRef>;
      if (!ref || typeof ref.key !== "string" || typeof ref.url !== "string") {
        return t("Invalid file reference.", "Referensi file tidak valid.");
      }
    }
    return null;
  }

  if (empty) {
    return def.required ? t("This field is required.", "Kolom ini wajib diisi.") : null;
  }

  if (def.type === "number") {
    if (typeof value !== "string" && typeof value !== "number") {
      return t("Enter a number.", "Masukkan angka.");
    }
    if (!Number.isFinite(Number(value))) {
      return t("Enter a valid number.", "Masukkan angka yang valid.");
    }
  }

  if (def.type === "date") {
    const d = new Date(String(value));
    if (!Number.isFinite(d.getTime())) {
      return t("Enter a valid date.", "Masukkan tanggal yang valid.");
    }
  }

  if (def.type === "select") {
    const allowed = def.options.map((o) => o.value);
    if (!allowed.includes(String(value))) {
      return t("Choose one of the options.", "Pilih salah satu opsi.");
    }
  }

  if (def.type === "text" || def.type === "textarea") {
    if (typeof value !== "string" || value.trim().length === 0) {
      return def.required ? t("This field is required.", "Kolom ini wajib diisi.") : null;
    }
    if (value.length > 2000) {
      return t("Text is too long (max 2000 characters).", "Teks terlalu panjang (maks 2000 karakter).");
    }
  }

  return null;
}

/** Validate a whole answers map against the visible fields of one scope. */
export function validateEvoaAnswers(
  defs: EvoaFieldDefDTO[],
  answers: EvoaAnswers,
  ctx: EvoaFieldContext,
  lang: "en" | "id" = "id",
): { ok: true } | { ok: false; fieldKey: string; error: string } {
  for (const def of defs) {
    if (!evoaFieldVisible(def.showWhen, ctx)) continue;
    const error = validateEvoaAnswer(def, answers[def.key], lang);
    if (error) return { ok: false, fieldKey: def.key, error };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Standard-form validation (pure)                                     */
/* ------------------------------------------------------------------ */

export const EVOA_EMAIL_RE = /^\S+@\S+\.\S+$/;
export const EVOA_PHONE_RE = /^[0-9+()\-\s]{6,20}$/;
export const EVOA_PASSPORT_RE = /^[A-Z0-9]{6,12}$/;

export function normalizePassportNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Months of validity required for the passport type. */
export function evoaMinValidityMonths(passportType: string): number {
  return passportType === "emergency"
    ? EVOA_EMERGENCY_MIN_VALIDITY_MONTHS
    : EVOA_MIN_VALIDITY_MONTHS;
}

/** Passport must stay valid N months beyond the arrival date. */
export function validatePassportValidity(
  expiryISO: string,
  arrivalISO: string,
  passportType: string,
): { ok: true } | { ok: false; error: string } {
  const expiry = new Date(expiryISO);
  const arrival = new Date(arrivalISO);
  if (!Number.isFinite(expiry.getTime()) || !Number.isFinite(arrival.getTime())) {
    return { ok: false, error: "Tanggal tidak valid." };
  }
  const months = evoaMinValidityMonths(passportType);
  const minExpiry = new Date(arrival);
  minExpiry.setMonth(minExpiry.getMonth() + months);
  if (expiry < minExpiry) {
    return {
      ok: false,
      error: `Paspor harus berlaku minimal ${months} bulan sejak tanggal kedatangan.`,
    };
  }
  return { ok: true };
}

/** True when arrival is so far out the 90-day visa validity may expire. */
export function evoaArrivalTooEarly(arrivalISO: string, now: Date = new Date()): boolean {
  const arrival = new Date(arrivalISO);
  if (!Number.isFinite(arrival.getTime())) return false;
  const limit = new Date(now);
  limit.setDate(limit.getDate() + EVOA_ARRIVAL_WARN_DAYS);
  return arrival > limit;
}

/* ------------------------------------------------------------------ */
/* DTOs shared by wizard / tracking / admin                            */
/* ------------------------------------------------------------------ */

export type EvoaDocumentDTO = {
  id: string;
  applicantId: string | null;
  slot: string;
  key: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  reviewStatus: string;
  reviewNote: string | null;
};

export type EvoaApplicantInput = {
  fullName: string;
  gender: string;
  dateOfBirth: string;
  placeOfBirth: string;
  nationality: string;
  passportNumber: string;
  passportType: string;
  passportIssuingCountry: string;
  passportIssueDate?: string;
  passportExpiryDate: string;
  email: string;
  phone: string;
  relation: string;
  extraAnswers: EvoaAnswers;
  /** Uploaded documents by slot — each entry already stored in R2. */
  documents: Record<string, EvoaFileRef[]>;
};

export type EvoaOrderInput = {
  contactName: string;
  email: string;
  phone: string;
  purpose: string;
  arrivalDate: string;
  flightNumber: string;
  portOfEntryId: string;
  departureDate?: string;
  departureFlightNumber?: string;
  hotelName: string;
  hotelAddress: string;
  hotelCity: string;
  hotelPostalCode?: string;
  note?: string;
  extraAnswers: EvoaAnswers;
  applicants: EvoaApplicantInput[];
  /** Client-generated dedupe key (mirrors Booking.idempotencyKey). */
  idempotencyKey?: string;
};

export type EvoaStatusEventDTO = {
  id: string;
  applicantId: string | null;
  status: string;
  note: string | null;
  actor: string;
  createdAt: string;
};

/** Group status derived from applicant statuses (display helper). */
export function deriveEvoaOrderStatus(
  orderStatus: string,
  applicantStatuses: string[],
): string {
  if (applicantStatuses.length === 0) return orderStatus;
  if (applicantStatuses.every((s) => s === "issued")) {
    return orderStatus === "completed" ? "completed" : "issued";
  }
  if (applicantStatuses.some((s) => s === "revision")) return "revision";
  return orderStatus;
}
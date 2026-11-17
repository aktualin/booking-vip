"use client";

import type { ReactNode } from "react";
import {
  EVOA_DOC_SLOTS,
  EVOA_GENDERS,
  EVOA_PASSPORT_TYPES,
  EVOA_RELATIONS,
  evoaMinValidityMonths,
  type EvoaFieldDefDTO,
  type EvoaFileRef,
} from "@/lib/evoa-shared";
import DynamicFields from "@/components/evoa/DynamicFields";
import DocumentsUpload from "./DocumentsUpload";
import {
  FIELD_CLASS,
  fieldClass,
  docsComplete,
  applicantField,
  applicantDocField,
  type ApplicantForm,
  type FieldError,
  type Lang,
} from "./shared";

/**
 * One applicant: a collapsible card carrying the personal data, passport
 * data, document uploads and the admin-defined applicant fields. The header
 * stays visible when collapsed so a group of five stays scannable.
 */

type Props = {
  index: number;
  applicant: ApplicantForm;
  countries: { code: string; name: string }[];
  applicantDefs: EvoaFieldDefDTO[];
  purpose: string;
  lang: Lang;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ApplicantForm>) => void;
  onAnswer: (key: string, value: string | boolean | EvoaFileRef[]) => void;
  onDocs: (slot: string, refs: EvoaFileRef[]) => void;
  onRemove: () => void;
  canRemove: boolean;
  error: FieldError;
  disabled?: boolean;
};

function Field({
  label,
  required,
  errored,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  errored?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className={`mb-1.5 block text-[12px] font-medium ${errored ? "text-danger" : "text-ink"}`}>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

export default function ApplicantCard({
  index,
  applicant,
  countries,
  applicantDefs,
  purpose,
  lang,
  open,
  onToggle,
  onChange,
  onAnswer,
  onDocs,
  onRemove,
  canRemove,
  error,
  disabled,
}: Props) {
  const t = (en: string, id: string) => (lang === "id" ? id : en);

  // Only errors addressed to THIS card highlight its inputs.
  const mine = error && error.field.startsWith(`applicant:${index}:`) ? error : null;
  const at = (name: string) => mine?.field === applicantField(index, name);
  const cls = (name: string) => fieldClass(FIELD_CLASS, at(name));
  const errorDocSlot = EVOA_DOC_SLOTS.find(
    (slot) => mine?.field === applicantDocField(index, slot.slot),
  )?.slot;

  const complete = docsComplete(applicant);
  const title = applicant.fullName.trim() || t(`Applicant ${index + 1}`, `Pemohon ${index + 1}`);

  return (
    <div className={`rounded-2xl border bg-white ${mine ? "border-danger/40" : "border-line"}`}>
      {/* Header — always visible */}
      <div className="flex items-center gap-2 p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
              complete ? "bg-brand-soft text-brand-dark" : "bg-canvas text-muted"
            }`}
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {applicant.passportNumber
                ? `${t("Passport", "Paspor")} ${applicant.passportNumber}`
                : t("Passport data not filled yet", "Data paspor belum diisi")}
              {" · "}
              {complete
                ? t("Required documents ready", "Dokumen wajib lengkap")
                : t("Required documents incomplete", "Dokumen wajib belum lengkap")}
            </span>
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {canRemove ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            aria-label={t(`Remove applicant ${index + 1}`, `Hapus pemohon ${index + 1}`)}
            className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-danger/5 hover:text-danger disabled:opacity-50"
          >
            {t("Remove", "Hapus")}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="grid gap-5 border-t border-line p-4 sm:p-5">
          {mine ? (
            <p className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[12px] text-danger">
              {mine.error}
            </p>
          ) : null}

          {/* Personal data */}
          <section>
            <h4 className="text-[13px] font-bold text-ink">{t("Personal data", "Data diri")}</h4>
            <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
              <Field label={t("Full name (as in passport)", "Nama lengkap (sesuai paspor)")} required errored={at("fullName")} className="sm:col-span-2">
                <input
                  type="text"
                  value={applicant.fullName}
                  disabled={disabled}
                  onChange={(e) => onChange({ fullName: e.target.value })}
                  className={cls("fullName")}
                />
              </Field>
              <Field label={t("Gender", "Jenis kelamin")} required errored={at("gender")}>
                <select
                  value={applicant.gender}
                  disabled={disabled}
                  onChange={(e) => onChange({ gender: e.target.value })}
                  className={cls("gender")}
                >
                  <option value="">{t("Select…", "Pilih…")}</option>
                  {EVOA_GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {lang === "id" ? g.id : g.en}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Date of birth", "Tanggal lahir")} required errored={at("dateOfBirth")}>
                <input
                  type="date"
                  value={applicant.dateOfBirth}
                  disabled={disabled}
                  onChange={(e) => onChange({ dateOfBirth: e.target.value })}
                  className={cls("dateOfBirth")}
                />
              </Field>
              <Field label={t("Place of birth", "Tempat lahir")} required errored={at("placeOfBirth")}>
                <input
                  type="text"
                  value={applicant.placeOfBirth}
                  disabled={disabled}
                  onChange={(e) => onChange({ placeOfBirth: e.target.value })}
                  placeholder={t("e.g. Singapore", "mis. Singapura")}
                  className={cls("placeOfBirth")}
                />
              </Field>
              <Field label={t("Nationality", "Kewarganegaraan")} required errored={at("nationality")}>
                <select
                  value={applicant.nationality}
                  disabled={disabled}
                  onChange={(e) => onChange({ nationality: e.target.value })}
                  className={cls("nationality")}
                >
                  <option value="">{t("Select country…", "Pilih negara…")}</option>
                  {countries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Relation to the booker", "Hubungan dengan pemesan")} required errored={at("relation")}>
                <select
                  value={applicant.relation}
                  disabled={disabled}
                  onChange={(e) => onChange({ relation: e.target.value })}
                  className={cls("relation")}
                >
                  {EVOA_RELATIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {lang === "id" ? r.id : r.en}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          {/* Passport */}
          <section className="border-t border-line pt-5">
            <h4 className="text-[13px] font-bold text-ink">{t("Passport", "Paspor")}</h4>
            <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
              <Field label={t("Passport number", "Nomor paspor")} required errored={at("passportNumber")}>
                <input
                  type="text"
                  value={applicant.passportNumber}
                  disabled={disabled}
                  onChange={(e) => onChange({ passportNumber: e.target.value.toUpperCase() })}
                  placeholder="A1234567"
                  className={`${cls("passportNumber")} font-mono tracking-[0.04em]`}
                />
              </Field>
              <Field label={t("Passport type", "Jenis paspor")} required errored={at("passportType")}>
                <select
                  value={applicant.passportType}
                  disabled={disabled}
                  onChange={(e) => onChange({ passportType: e.target.value })}
                  className={cls("passportType")}
                >
                  {EVOA_PASSPORT_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {lang === "id" ? p.id : p.en}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Issuing country", "Negara penerbit")} required errored={at("passportIssuingCountry")}>
                <select
                  value={applicant.passportIssuingCountry}
                  disabled={disabled}
                  onChange={(e) => onChange({ passportIssuingCountry: e.target.value })}
                  className={cls("passportIssuingCountry")}
                >
                  <option value="">{t("Select country…", "Pilih negara…")}</option>
                  {countries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Issue date (optional)", "Tanggal terbit (opsional)")} errored={at("passportIssueDate")}>
                <input
                  type="date"
                  value={applicant.passportIssueDate}
                  disabled={disabled}
                  onChange={(e) => onChange({ passportIssueDate: e.target.value })}
                  className={cls("passportIssueDate")}
                />
              </Field>
              <Field label={t("Expiry date", "Tanggal kedaluwarsa")} required errored={at("passportExpiryDate")} className="sm:col-span-2">
                <input
                  type="date"
                  value={applicant.passportExpiryDate}
                  disabled={disabled}
                  onChange={(e) => onChange({ passportExpiryDate: e.target.value })}
                  className={cls("passportExpiryDate")}
                />
              </Field>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {t(
                `The passport must stay valid at least ${evoaMinValidityMonths(applicant.passportType)} months after arrival.`,
                `Paspor harus berlaku minimal ${evoaMinValidityMonths(applicant.passportType)} bulan setelah tanggal kedatangan.`,
              )}
            </p>
          </section>

          {/* Delivery contact */}
          <section className="border-t border-line pt-5">
            <h4 className="text-[13px] font-bold text-ink">
              {t("e-VOA delivery contact", "Kontak pengiriman e-VOA")}
            </h4>
            <p className="mt-0.5 text-[12px] text-muted">
              {t(
                "The issued e-VOA is sent to this email.",
                "e-VOA yang terbit dikirim ke email ini.",
              )}
            </p>
            <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
              <Field label="Email" required errored={at("email")}>
                <input
                  type="email"
                  value={applicant.email}
                  disabled={disabled}
                  onChange={(e) => onChange({ email: e.target.value })}
                  className={cls("email")}
                />
              </Field>
              <Field label={t("Phone / WhatsApp", "Telepon / WhatsApp")} required errored={at("phone")}>
                <input
                  type="tel"
                  value={applicant.phone}
                  disabled={disabled}
                  onChange={(e) => onChange({ phone: e.target.value })}
                  placeholder="08xx xxxx xxxx"
                  className={cls("phone")}
                />
              </Field>
            </div>
          </section>

          {/* Documents */}
          <section className="border-t border-line pt-5">
            <h4 className="text-[13px] font-bold text-ink">{t("Documents", "Dokumen")}</h4>
            <p className="mt-0.5 mb-3 text-[12px] text-muted">
              {t(
                "Upload clear scans/photos — we submit them to the official portal.",
                "Unggah hasil pindai/foto yang jelas — kami yang mengirimkannya ke portal resmi.",
              )}
            </p>
            <DocumentsUpload
              documents={applicant.documents}
              onChange={onDocs}
              lang={lang}
              disabled={disabled}
              errorSlot={errorDocSlot}
            />
          </section>

          {/* Admin-defined applicant fields */}
          {applicantDefs.length > 0 ? (
            <section className="border-t border-line pt-5">
              <h4 className="mb-3 text-[13px] font-bold text-ink">
                {t("Additional information", "Informasi tambahan")}
              </h4>
              <DynamicFields
                defs={applicantDefs}
                answers={applicant.extraAnswers}
                onChange={onAnswer}
                purpose={purpose}
                lang={lang}
                disabled={disabled}
              />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
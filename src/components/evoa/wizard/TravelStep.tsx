"use client";

import type { ReactNode } from "react";
import { EVOA_PURPOSES, evoaArrivalTooEarly } from "@/lib/evoa-shared";
import type { EvoaFormData } from "@/app/actions/evoa";
import { FIELD_CLASS, AREA_CLASS, fieldClass, todayISO, type FieldError, type Lang, type TravelForm } from "./shared";

/**
 * Step 1 — the shared travel plan: the pemesan's contact, purpose, arrival
 * flight + checkpoint, optional departure, and the Indonesian accommodation.
 */

type Props = {
  travel: TravelForm;
  onChange: (patch: Partial<TravelForm>) => void;
  data: EvoaFormData;
  lang: Lang;
  error: FieldError;
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

export default function TravelStep({ travel, onChange, data, lang, error }: Props) {
  const t = (en: string, id: string) => (lang === "id" ? id : en);
  const at = (field: string) => error?.field === field;
  const cls = (field: string, base: string = FIELD_CLASS) => fieldClass(base, at(field));

  const tooEarly = travel.arrivalDate ? evoaArrivalTooEarly(travel.arrivalDate) : false;

  return (
    <div className="grid gap-5">
      {/* Pemesan contact */}
      <section>
        <h3 className="text-[14px] font-bold text-ink">
          {t("Booker contact", "Kontak pemesan")}
        </h3>
        <p className="mt-0.5 text-[12px] text-muted">
          {t(
            "We contact this person about the application — not necessarily a traveller.",
            "Kami menghubungi orang ini soal pengajuan — tidak harus ikut bepergian.",
          )}
        </p>
        <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
          <Field label={t("Booker name", "Nama pemesan")} required errored={at("contactName")} className="sm:col-span-2">
            <input
              type="text"
              value={travel.contactName}
              onChange={(e) => onChange({ contactName: e.target.value })}
              className={cls("contactName")}
            />
          </Field>
          <Field label="Email" required errored={at("email")}>
            <input
              type="email"
              value={travel.email}
              onChange={(e) => onChange({ email: e.target.value })}
              className={cls("email")}
            />
          </Field>
          <Field label={t("Phone / WhatsApp", "Telepon / WhatsApp")} required errored={at("phone")}>
            <input
              type="tel"
              value={travel.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="08xx xxxx xxxx"
              className={cls("phone")}
            />
          </Field>
        </div>
      </section>

      {/* Arrival */}
      <section className="border-t border-line pt-5">
        <h3 className="text-[14px] font-bold text-ink">{t("Arrival plan", "Rencana kedatangan")}</h3>
        <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
          <Field label={t("Purpose of visit", "Tujuan kedatangan")} required errored={at("purpose")}>
            <select
              value={travel.purpose}
              onChange={(e) => onChange({ purpose: e.target.value })}
              className={cls("purpose")}
            >
              {EVOA_PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {lang === "id" ? p.id : p.en}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Arrival date", "Tanggal kedatangan")} required errored={at("arrivalDate")}>
            <input
              type="date"
              value={travel.arrivalDate}
              min={todayISO()}
              onChange={(e) => onChange({ arrivalDate: e.target.value })}
              className={cls("arrivalDate")}
            />
          </Field>
          <Field label={t("Arrival flight number", "Nomor penerbangan datang")} required errored={at("flightNumber")}>
            <input
              type="text"
              value={travel.flightNumber}
              onChange={(e) => onChange({ flightNumber: e.target.value.toUpperCase() })}
              placeholder="GA831"
              className={`${cls("flightNumber")} font-mono tracking-[0.04em]`}
            />
          </Field>
          <Field label={t("Arrival airport (immigration checkpoint)", "Bandara kedatangan (TPI)")} required errored={at("portOfEntryId")}>
            <select
              value={travel.portOfEntryId}
              onChange={(e) => onChange({ portOfEntryId: e.target.value })}
              className={cls("portOfEntryId")}
            >
              <option value="">{t("Select airport…", "Pilih bandara…")}</option>
              {data.airports.map((airport) => (
                <option key={airport.id} value={airport.id}>
                  {airport.name}
                  {airport.iataCode ? ` (${airport.iataCode})` : ""} — {airport.city}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Departure date (optional)", "Tanggal kepulangan (opsional)")} errored={at("departureDate")}>
            <input
              type="date"
              value={travel.departureDate}
              min={travel.arrivalDate || undefined}
              onChange={(e) => onChange({ departureDate: e.target.value })}
              className={cls("departureDate")}
            />
          </Field>
          <Field label={t("Departure flight number (optional)", "Nomor penerbangan pulang (opsional)")} errored={at("departureFlightNumber")}>
            <input
              type="text"
              value={travel.departureFlightNumber}
              onChange={(e) => onChange({ departureFlightNumber: e.target.value.toUpperCase() })}
              placeholder="SQ957"
              className={`${cls("departureFlightNumber")} font-mono tracking-[0.04em]`}
            />
          </Field>
        </div>

        {tooEarly ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-800">
            {t(
              "Heads up: the e-VOA is valid 90 days from issue. Your arrival is more than 80 days away, so the visa could expire before you travel. We may contact you to time the application.",
              "Perhatian: e-VOA berlaku 90 hari sejak terbit. Kedatangan kamu lebih dari 80 hari lagi, jadi visa bisa kedaluwarsa sebelum berangkat. Kami mungkin menghubungi kamu untuk mengatur waktu pengajuan.",
            )}
          </p>
        ) : null}

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          {t(
            `Apply at least ${data.settings.minLeadTimeDays} day(s) before arrival so we can process it in time.`,
            `Ajukan minimal ${data.settings.minLeadTimeDays} hari sebelum kedatangan supaya sempat diproses.`,
          )}
        </p>
      </section>

      {/* Accommodation */}
      <section className="border-t border-line pt-5">
        <h3 className="text-[14px] font-bold text-ink">
          {t("Accommodation in Indonesia", "Akomodasi di Indonesia")}
        </h3>
        <p className="mt-0.5 text-[12px] text-muted">
          {t(
            "The first hotel / place you stay at — required by immigration.",
            "Hotel / tempat tinggal pertama — diminta oleh imigrasi.",
          )}
        </p>
        <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
          <Field label={t("Hotel / stay name", "Nama hotel / tempat tinggal")} required errored={at("hotelName")} className="sm:col-span-2">
            <input
              type="text"
              value={travel.hotelName}
              onChange={(e) => onChange({ hotelName: e.target.value })}
              className={cls("hotelName")}
            />
          </Field>
          <Field label={t("Address", "Alamat")} required errored={at("hotelAddress")} className="sm:col-span-2">
            <textarea
              rows={2}
              value={travel.hotelAddress}
              onChange={(e) => onChange({ hotelAddress: e.target.value })}
              className={cls("hotelAddress", AREA_CLASS)}
            />
          </Field>
          <Field label={t("City", "Kota")} required errored={at("hotelCity")}>
            <input
              type="text"
              value={travel.hotelCity}
              onChange={(e) => onChange({ hotelCity: e.target.value })}
              placeholder={t("e.g. Denpasar", "mis. Denpasar")}
              className={cls("hotelCity")}
            />
          </Field>
          <Field label={t("Postal code (optional)", "Kode pos (opsional)")}>
            <input
              type="text"
              value={travel.hotelPostalCode}
              onChange={(e) => onChange({ hotelPostalCode: e.target.value })}
              className={FIELD_CLASS}
            />
          </Field>
        </div>
      </section>
    </div>
  );
}
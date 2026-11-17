"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  EVOA_DOC_SLOTS,
  EVOA_GENDERS,
  EVOA_PASSPORT_TYPES,
  EVOA_PURPOSES,
  EVOA_RELATIONS,
  evoaFieldVisible,
  type EvoaAnswers,
  type EvoaFieldDefDTO,
} from "@/lib/evoa-shared";
import { quoteEvoaFor, type EvoaFormData } from "@/app/actions/evoa";
import type { EvoaQuote } from "@/lib/evoa-pricing";
import {
  docCount,
  formatDate,
  idr,
  usd,
  type ApplicantForm,
  type Lang,
  type TravelForm,
} from "./shared";

/**
 * Step 4 — the read-only recap before payment: travel plan, every applicant
 * with their document counts, the dynamic answers, and the price breakdown.
 * The confirmation checkbox gates the submit button (owned by the wizard).
 *
 * The price shown is the client-side quote (unit × count); the server
 * re-quotes at submit time and the booking stores the authoritative total.
 */

type Props = {
  travel: TravelForm;
  applicants: ApplicantForm[];
  data: EvoaFormData;
  orderAnswers: EvoaAnswers;
  note: string;
  lang: Lang;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
  /** Jump back to a wizard step to fix something. */
  onEdit: (step: number) => void;
  disabled?: boolean;
};

/* ------------------------------------------------------------------ */
/* Small display helpers                                               */
/* ------------------------------------------------------------------ */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <span className="min-w-0 text-right text-[12px] font-medium text-ink">
        {value || "—"}
      </span>
    </div>
  );
}

function Section({
  title,
  editLabel,
  onEdit,
  children,
}: {
  title: string;
  editLabel: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-canvas/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-bold text-ink">{title}</h4>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 text-[12px] font-semibold text-brand transition-colors hover:text-brand-dark"
        >
          {editLabel}
        </button>
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Human-readable value of one dynamic answer (files → names, select → label). */
function answerText(
  def: EvoaFieldDefDTO,
  value: unknown,
  lang: Lang,
): string {
  const t = (en: string, id: string) => (lang === "id" ? id : en);
  if (def.type === "checkbox") {
    return value === true ? t("Yes", "Ya") : t("No", "Tidak");
  }
  if (def.type === "file") {
    const files = Array.isArray(value) ? value : [];
    if (files.length === 0) return "—";
    return files.map((f) => (f as { fileName?: string }).fileName ?? "file").join(", ");
  }
  if (value == null || value === "") return "—";
  if (def.type === "select") {
    const option = def.options.find((o) => o.value === String(value));
    if (!option) return String(value);
    return lang === "id" ? (option.labelId ?? option.labelEn) : option.labelEn;
  }
  if (def.type === "date") return formatDate(String(value), lang);
  return String(value);
}

/** The visible dynamic answers of one scope, as label/value rows. */
function AnswerRows({
  defs,
  answers,
  purpose,
  lang,
}: {
  defs: EvoaFieldDefDTO[];
  answers: EvoaAnswers;
  purpose: string;
  lang: Lang;
}) {
  const visible = defs.filter((def) =>
    evoaFieldVisible(def.showWhen, { purpose, answers }),
  );
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((def) => (
        <Row
          key={def.id}
          label={lang === "id" ? (def.labelId ?? def.labelEn) : def.labelEn}
          value={answerText(def, answers[def.key], lang)}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step                                                                */
/* ------------------------------------------------------------------ */

export default function ReviewStep({
  travel,
  applicants,
  data,
  orderAnswers,
  note,
  lang,
  confirmed,
  onConfirm,
  onEdit,
  disabled,
}: Props) {
  const t = (en: string, id: string) => (lang === "id" ? id : en);

  const purposeLabel =
    EVOA_PURPOSES.find((p) => p.value === travel.purpose)?.[lang] ?? travel.purpose;
  const airport = data.airports.find((a) => a.id === travel.portOfEntryId);
  const countryName = (code: string) =>
    data.countries.find((c) => c.code === code)?.name ?? code;

  const n = applicants.length;

  // A live quote for the actual applicant count — it includes the configured
  // taxes (admin → Pajak), so the breakdown here matches what the submit path
  // charges. Until it resolves, the per-person quote estimates the fees.
  const [liveQuote, setLiveQuote] = useState<EvoaQuote | null>(null);
  useEffect(() => {
    let cancelled = false;
    quoteEvoaFor(n).then((result) => {
      if (!cancelled && result.ok) setLiveQuote(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [n]);

  const quote = liveQuote ?? data.quote;
  // Fees before tax — the server re-quotes at submit; this is the display.
  const subtotalUsdCents = quote.unitUsdCents * n;
  const taxUsdCents = liveQuote ? liveQuote.taxUsdCents : 0;
  const totalUsdCents = subtotalUsdCents + taxUsdCents;
  const idrEstimate = (totalUsdCents / 100) * quote.rate;

  const visibleOrderDefs = data.fieldDefs.application.filter((def) =>
    evoaFieldVisible(def.showWhen, { purpose: travel.purpose, answers: orderAnswers }),
  );
  const hasExtras = visibleOrderDefs.length > 0 || note.trim().length > 0;

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-[14px] font-bold text-ink">
          {t("Review your application", "Periksa pengajuan kamu")}
        </h3>
        <p className="mt-0.5 text-[12px] text-muted">
          {t(
            "Make sure everything matches the passports — we submit it to the official portal as-is.",
            "Pastikan semua sesuai paspor — kami mengirimkannya ke portal resmi apa adanya.",
          )}
        </p>
      </div>

      {/* Travel plan */}
      <Section
        title={t("Travel plan", "Rencana perjalanan")}
        editLabel={t("Edit", "Ubah")}
        onEdit={() => onEdit(0)}
      >
        <Row label={t("Booker", "Pemesan")} value={travel.contactName} />
        <Row label="Email" value={travel.email} />
        <Row label={t("Phone", "Telepon")} value={travel.phone} />
        <Row label={t("Purpose", "Tujuan")} value={purposeLabel} />
        <Row
          label={t("Arrival", "Kedatangan")}
          value={`${formatDate(travel.arrivalDate, lang)} · ${travel.flightNumber}`}
        />
        <Row
          label={t("Entry airport", "Bandara masuk")}
          value={airport ? `${airport.name}${airport.iataCode ? ` (${airport.iataCode})` : ""}` : ""}
        />
        {travel.departureDate ? (
          <Row
            label={t("Departure", "Kepulangan")}
            value={`${formatDate(travel.departureDate, lang)}${
              travel.departureFlightNumber ? ` · ${travel.departureFlightNumber}` : ""
            }`}
          />
        ) : null}
        <Row label={t("Accommodation", "Akomodasi")} value={travel.hotelName} />
        <Row
          label={t("Address", "Alamat")}
          value={[travel.hotelAddress, travel.hotelCity, travel.hotelPostalCode]
            .filter(Boolean)
            .join(", ")}
        />
      </Section>

      {/* Applicants */}
      <Section
        title={`${t("Applicants", "Pemohon")} (${n})`}
        editLabel={t("Edit", "Ubah")}
        onEdit={() => onEdit(1)}
      >
        <div className="grid gap-3">
          {applicants.map((applicant, index) => {
            const gender = EVOA_GENDERS.find((g) => g.value === applicant.gender)?.[lang];
            const passportType =
              EVOA_PASSPORT_TYPES.find((p) => p.value === applicant.passportType)?.[lang];
            const relation =
              EVOA_RELATIONS.find((r) => r.value === applicant.relation)?.[lang];
            const slotCounts = EVOA_DOC_SLOTS.map((slot) => {
              const count = applicant.documents[slot.slot]?.length ?? 0;
              return `${lang === "id" ? slot.id : slot.en}: ${count}`;
            }).join(" · ");

            return (
              <div
                key={applicant.key}
                className="rounded-xl border border-line bg-white p-3.5"
              >
                <p className="text-[13px] font-semibold text-ink">
                  {index + 1}. {applicant.fullName || t(`Applicant ${index + 1}`, `Pemohon ${index + 1}`)}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {t("Passport", "Paspor")} {applicant.passportNumber || "—"}
                  {passportType ? ` · ${passportType}` : ""}
                </p>
                <div className="mt-1.5">
                  <Row
                    label={t("Born", "Lahir")}
                    value={`${applicant.placeOfBirth || "—"}, ${formatDate(applicant.dateOfBirth, lang)}`}
                  />
                  <Row
                    label={t("Nationality", "Kewarganegaraan")}
                    value={countryName(applicant.nationality)}
                  />
                  <Row label={t("Gender", "Jenis kelamin")} value={gender ?? ""} />
                  <Row label={t("Relation", "Hubungan")} value={relation ?? ""} />
                  <Row
                    label={t("Passport valid until", "Paspor berlaku sampai")}
                    value={formatDate(applicant.passportExpiryDate, lang)}
                  />
                  <Row label={t("Documents", "Dokumen")} value={slotCounts} />
                  <Row
                    label={t("Total files", "Total file")}
                    value={String(docCount(applicant, data))}
                  />
                  <AnswerRows
                    defs={data.fieldDefs.applicant}
                    answers={applicant.extraAnswers}
                    purpose={travel.purpose}
                    lang={lang}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Order-level extras */}
      {hasExtras ? (
        <Section
          title={t("Additional information", "Informasi tambahan")}
          editLabel={t("Edit", "Ubah")}
          onEdit={() => onEdit(2)}
        >
          <AnswerRows
            defs={data.fieldDefs.application}
            answers={orderAnswers}
            purpose={travel.purpose}
            lang={lang}
          />
          {note.trim() ? <Row label={t("Note", "Catatan")} value={note} /> : null}
        </Section>
      ) : null}

      {/* Price breakdown */}
      <section className="rounded-xl border border-line bg-white p-4">
        <h4 className="text-[13px] font-bold text-ink">{t("Price", "Harga")}</h4>
        <div className="mt-2">
          <Row
            label={`${n} × (${t("service fee", "biaya jasa")} ${usd(quote.serviceFeeUsdCents)} + ${t("official fee", "biaya resmi")} ${usd(quote.officialFeeUsdCents)})`}
            value={usd(subtotalUsdCents)}
          />
          <Row
            label={t("Official fee per person (IDR)", "Biaya resmi per orang (IDR)")}
            value={idr(quote.officialFeeIdr)}
          />
          {liveQuote?.taxes.map((line) => (
            <Row
              key={line.key}
              label={`${t("Tax", "Pajak")} · ${line.label} (${line.value})`}
              value={usd(line.amountUsdCents)}
            />
          ))}
          <div className="mt-2 flex items-start justify-between gap-3 border-t border-line pt-2">
            <span className="text-[13px] font-semibold text-ink">
              {t("Estimated total (IDR)", "Perkiraan total (IDR)")}
            </span>
            <span className="text-right">
              <span className="block text-[15px] font-bold text-ink">{idr(idrEstimate)}</span>
              <span className="block text-[11px] text-muted">≈ {usd(totalUsdCents)}</span>
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            {t(
              `Rate used: 1 USD ≈ ${idr(quote.rate)}. You pay in IDR on the Xendit checkout page; the final amount is frozen there.`,
              `Kurs yang dipakai: 1 USD ≈ ${idr(quote.rate)}. Pembayaran dalam IDR di halaman checkout Xendit; nominal akhir dikunci di sana.`,
            )}
          </p>
          <p className="mt-2 rounded-xl bg-brand-soft px-3 py-2 text-[11px] leading-relaxed text-brand-dark">
            {t(
              `Processed within ${data.settings.slaHours} hours after payment and complete documents (business hours).`,
              `Diproses dalam ${data.settings.slaHours} jam setelah pembayaran dan dokumen lengkap (jam kerja).`,
            )}
          </p>
        </div>
      </section>

      {/* Confirmation — gates the submit button */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-white p-4">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled}
          onChange={(e) => onConfirm(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line accent-brand"
        />
        <span className="text-[12px] leading-relaxed text-ink">
          {t(
            "I confirm the data matches the passports and the documents are genuine. I understand the official immigration fee is non-refundable once the application is submitted.",
            "Saya menyatakan data sesuai paspor dan dokumen asli. Saya memahami biaya resmi imigrasi tidak dapat dikembalikan setelah pengajuan dikirim.",
          )}
          <span className="text-danger"> *</span>
        </span>
      </label>
    </div>
  );
}

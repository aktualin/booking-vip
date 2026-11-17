"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getEvoaFormData,
  submitEvoaApplication,
  type EvoaFormData,
} from "@/app/actions/evoa";
import { startBookingPayment } from "@/app/actions/payments";
import { showToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/LocaleProvider";
import DynamicFields from "@/components/evoa/DynamicFields";
import PayPalPayButton from "@/components/payment/PayPalPayButton";
import WizardSteps from "./wizard/WizardSteps";
import TravelStep from "./wizard/TravelStep";
import ApplicantCard from "./wizard/ApplicantCard";
import ReviewStep from "./wizard/ReviewStep";
import {
  AREA_CLASS,
  applicantIndexForField,
  emptyTravel,
  findDuplicatePassport,
  newApplicant,
  stepForField,
  usd,
  validateApplicant,
  validateOrderAnswers,
  validateTravel,
  type ApplicantForm,
  type FieldError,
  type TravelForm,
} from "./wizard/shared";
import {
  EVOA_MAX_APPLICANTS,
  normalizePassportNumber,
  type EvoaAnswers,
  type EvoaFileRef,
  type EvoaOrderInput,
} from "@/lib/evoa-shared";

export type EvoaStepDTO = {
  title: string;
  body: string;
};

type Props = {
  /** The three "how it works" steps — both languages. */
  steps: { en: EvoaStepDTO[]; id: EvoaStepDTO[] };
};

type SubmitData = { code: string; bookingCode: string; totalUsdCents: number };

/**
 * The e-VOA application wizard.
 *
 * e-VOA is a visa *service*: the customer hands us the travel plan and the
 * passport data + documents of 1..5 people and we handle the official
 * application. Four steps — travel, applicants, admin-defined extras, review —
 * then the order is created server-side and the browser is redirected to the
 * Xendit checkout.
 *
 * Client validation mirrors the server rules (wizard/shared.ts) to save a
 * round-trip; the server action re-validates everything and is the authority.
 */
export default function EvoaApplyForm({ steps }: Props) {
  const { lang } = useLocale();
  const t = (en: string, id: string) => (lang === "id" ? id : en);

  /* ---------------- form data (countries, airports, fields, quote) ---------------- */

  const [data, setData] = useState<EvoaFormData | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const result = await getEvoaFormData();
      if (result.ok) {
        setData(result.data);
        setLoadState("ready");
      } else {
        showToast(result.error, "error");
        setLoadState("error");
      }
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------------- wizard state ---------------- */

  const [step, setStep] = useState(0);
  const [travel, setTravel] = useState<TravelForm>(emptyTravel);
  const [applicants, setApplicants] = useState<ApplicantForm[]>(() => [newApplicant()]);
  const [openKey, setOpenKey] = useState<string | null>(() => applicants[0]!.key);
  const [orderAnswers, setOrderAnswers] = useState<EvoaAnswers>({});
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<FieldError>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitData | null>(null);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // One dedupe key per form session — a retried submit reuses the booking
  // instead of creating a second one (mirrors Booking.idempotencyKey).
  const idempotencyKey = useRef("");
  if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

  const topRef = useRef<HTMLDivElement>(null);
  const scrollTop = () =>
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const list = (lang === "id" ? steps.id : steps.en) ?? steps.en ?? [];
  const maxApplicants = data
    ? Math.min(data.settings.maxApplicants, EVOA_MAX_APPLICANTS)
    : EVOA_MAX_APPLICANTS;

  /* ---------------- applicant list handlers ---------------- */

  const patchApplicant = (key: string, patch: Partial<ApplicantForm>) =>
    setApplicants((rows) => rows.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  const answerApplicant = (key: string, fieldKey: string, value: string | boolean | EvoaFileRef[]) =>
    setApplicants((rows) =>
      rows.map((a) =>
        a.key === key ? { ...a, extraAnswers: { ...a.extraAnswers, [fieldKey]: value } } : a,
      ),
    );

  const docsApplicant = (key: string, slot: string, refs: EvoaFileRef[]) =>
    setApplicants((rows) =>
      rows.map((a) => (a.key === key ? { ...a, documents: { ...a.documents, [slot]: refs } } : a)),
    );

  const addApplicant = () => {
    if (applicants.length >= maxApplicants) return;
    const fresh = newApplicant();
    setApplicants((rows) => [...rows, fresh]);
    setOpenKey(fresh.key);
  };

  const removeApplicant = (key: string) => {
    if (applicants.length <= 1) return;
    const next = applicants.filter((a) => a.key !== key);
    setApplicants(next);
    if (openKey === key) setOpenKey(next[0]?.key ?? null);
  };

  /* ---------------- navigation + per-step validation ---------------- */

  const fail = (e: FieldError) => {
    setError(e);
    if (e) showToast(e.error, "error");
  };

  /** Validate one applicant and open its card when it fails. */
  const checkApplicants = (): boolean => {
    if (!data) return false;
    for (let i = 0; i < applicants.length; i++) {
      const e = validateApplicant(applicants[i]!, i, travel, data, lang);
      if (e) {
        setOpenKey(applicants[i]!.key);
        fail(e);
        return false;
      }
    }
    const dup = findDuplicatePassport(applicants, lang);
    if (dup) {
      const index = applicantIndexForField(dup.field);
      if (index !== null && applicants[index]) setOpenKey(applicants[index]!.key);
      fail(dup);
      return false;
    }
    return true;
  };

  const goNext = () => {
    if (!data || submitting) return;
    setError(null);
    if (step === 0) {
      const e = validateTravel(travel, data, lang);
      if (e) return fail(e);
      setStep(1);
    } else if (step === 1) {
      if (!checkApplicants()) return;
      setStep(2);
    } else if (step === 2) {
      const e = validateOrderAnswers(data, orderAnswers, travel.purpose, lang);
      if (e) return fail(e);
      setStep(3);
    }
    scrollTop();
  };

  const goTo = (target: number) => {
    setStep(target);
    setError(null);
    // Editing after confirming invalidates the confirmation.
    if (target !== 3) setConfirmed(false);
    scrollTop();
  };

  /* ---------------- submit + payment hand-off ---------------- */

  const beginPayment = async (
    bookingCode: string,
    email: string,
    methodCode = "CREDIT_CARD",
  ) => {
    setPaying(true);
    setPaymentError(null);
    try {
      const payment = await startBookingPayment({
        bookingCode,
        email,
        methodCode,
      });
      if (payment.ok) {
        // Full navigation — the chosen gateway (Xendit or PayPal) hosts the
        // checkout; the return page polls the payment status afterwards.
        window.location.href = payment.checkoutUrl;
        return;
      }
      setPaymentError(payment.error);
      showToast(payment.error, "error");
    } catch {
      const message = t(
        "Payment could not be started. Try again.",
        "Pembayaran tidak bisa dimulai. Coba lagi.",
      );
      setPaymentError(message);
      showToast(message, "error");
    }
    setPaying(false);
    setSubmitting(false);
  };

  const handleSubmit = async (methodCode = "CREDIT_CARD") => {
    if (!data || submitting || paying) return;
    if (!confirmed) {
      fail({
        field: "confirm",
        error: t(
          "Please confirm the data matches the passports.",
          "Centang pernyataan bahwa data sesuai paspor.",
        ),
      });
      return;
    }

    // Re-validate everything — the customer may have edited earlier steps.
    const travelError = validateTravel(travel, data, lang);
    if (travelError) {
      setStep(0);
      return fail(travelError);
    }
    if (!checkApplicants()) {
      setStep(1);
      return;
    }
    const answersError = validateOrderAnswers(data, orderAnswers, travel.purpose, lang);
    if (answersError) {
      setStep(2);
      return fail(answersError);
    }

    setSubmitting(true);
    setError(null);

    const input: EvoaOrderInput = {
      contactName: travel.contactName,
      email: travel.email,
      phone: travel.phone,
      purpose: travel.purpose,
      arrivalDate: travel.arrivalDate,
      flightNumber: travel.flightNumber,
      portOfEntryId: travel.portOfEntryId,
      departureDate: travel.departureDate || undefined,
      departureFlightNumber: travel.departureFlightNumber || undefined,
      hotelName: travel.hotelName,
      hotelAddress: travel.hotelAddress,
      hotelCity: travel.hotelCity,
      hotelPostalCode: travel.hotelPostalCode || undefined,
      note: note || undefined,
      extraAnswers: orderAnswers,
      applicants: applicants.map((a) => ({
        fullName: a.fullName,
        gender: a.gender,
        dateOfBirth: a.dateOfBirth,
        placeOfBirth: a.placeOfBirth,
        nationality: a.nationality,
        passportNumber: normalizePassportNumber(a.passportNumber),
        passportType: a.passportType,
        passportIssuingCountry: a.passportIssuingCountry,
        passportIssueDate: a.passportIssueDate || undefined,
        passportExpiryDate: a.passportExpiryDate,
        email: a.email,
        phone: a.phone,
        relation: a.relation,
        extraAnswers: a.extraAnswers,
        documents: a.documents,
      })),
      idempotencyKey: idempotencyKey.current,
    };

    try {
      const submit = await submitEvoaApplication(input);
      if (!submit.ok) {
        setSubmitting(false);
        // Jump to the step the server error belongs to and highlight the field.
        setStep(stepForField(submit.field));
        const index = applicantIndexForField(submit.field);
        if (index !== null && applicants[index]) setOpenKey(applicants[index]!.key);
        setError({ field: submit.field ?? "", error: submit.error });
        showToast(submit.error, "error");
        scrollTop();
        return;
      }
      setResult(submit.data);
      showToast(
        t("Application created. Preparing payment…", "Pengajuan dibuat. Menyiapkan pembayaran…"),
        "success",
      );
      await beginPayment(submit.data.bookingCode, travel.email, methodCode);
    } catch {
      setSubmitting(false);
      const message = t(
        "The application could not be submitted. Try again.",
        "Pengajuan tidak bisa dikirim. Coba lagi.",
      );
      setError({ field: "", error: message });
      showToast(message, "error");
    }
  };

  /* ---------------- loading / load error ---------------- */

  if (loadState === "loading") {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-line bg-white p-6">
          <div className="h-6 w-2/3 animate-pulse rounded-lg bg-canvas" />
          <div className="mt-6 grid gap-3.5 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-canvas" />
            ))}
          </div>
          <div className="mt-6 h-11 w-40 animate-pulse rounded-xl bg-canvas" />
        </div>
        <div className="hidden rounded-2xl border border-line bg-white p-5 lg:block">
          <div className="h-5 w-1/2 animate-pulse rounded-lg bg-canvas" />
          <div className="mt-4 grid gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-canvas" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadState === "error" || !data) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-8 text-center">
        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
          {t("The form could not be loaded", "Formulir tidak bisa dimuat")}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {t(
            "Check your connection and try again — your data is not lost.",
            "Periksa koneksi kamu dan coba lagi — data kamu tidak hilang.",
          )}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand px-6 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
        >
          {t("Try again", "Coba lagi")}
        </button>
      </div>
    );
  }

  /* ---------------- success (order created) ---------------- */

  if (result) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-dark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m5 13 4 4L19 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <h1 className="mt-4 text-[20px] font-bold tracking-[-0.01em] text-ink">
          {t("Your application is in", "Pengajuan kamu sudah masuk")}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {paying
            ? t("Redirecting to the payment page…", "Mengalihkan ke halaman pembayaran…")
            : t(
                "Save this application number. Pay now to start processing, or pay later from the tracking page.",
                "Simpan nomor pengajuan ini. Bayar sekarang supaya langsung diproses, atau bayar nanti lewat halaman pelacakan.",
              )}
        </p>

        <p className="mt-5 rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-[16px] font-bold tracking-[0.06em] text-ink">
          {result.code}
        </p>
        <p className="mt-2 text-[13px] text-muted">
          {t("Total", "Total")}: <span className="font-semibold text-ink">{usd(result.totalUsdCents)}</span>
        </p>

        {paymentError ? (
          <p className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
            {paymentError}
          </p>
        ) : null}

        {paying ? (
          <div className="mt-6 flex items-center justify-center gap-2 text-[13px] text-muted">
            <svg className="h-4 w-4 animate-spin text-brand" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            {t("Preparing checkout…", "Menyiapkan checkout…")}
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void beginPayment(result.bookingCode, travel.email)}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
            >
              {paymentError ? t("Retry payment", "Coba bayar lagi") : t("Pay now", "Bayar sekarang")}
            </button>
            <Link
              href={`/account/visa/${encodeURIComponent(result.code)}`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
            >
              {t("Pay later", "Bayar nanti")}
            </Link>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- wizard ---------------- */

  return (
    <div ref={topRef} className="grid scroll-mt-24 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 rounded-2xl border border-line bg-white">
        {/* Step indicator */}
        <div className="border-b border-line p-4 sm:px-6 sm:py-5">
          <WizardSteps step={step} lang={lang} onBack={goTo} />
        </div>

        <div className="p-4 sm:p-6">
          {step === 0 ? (
            <TravelStep
              travel={travel}
              onChange={(patch) => setTravel((v) => ({ ...v, ...patch }))}
              data={data}
              lang={lang}
              error={error}
            />
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-bold text-ink">
                    {t("Applicant data", "Data pemohon")}
                  </h3>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {t(
                      `${applicants.length} of ${maxApplicants} people — exactly as printed in the passport.`,
                      `${applicants.length} dari ${maxApplicants} orang — sesuai yang tercetak di paspor.`,
                    )}
                  </p>
                </div>
              </div>

              {applicants.map((applicant, index) => (
                <ApplicantCard
                  key={applicant.key}
                  index={index}
                  applicant={applicant}
                  countries={data.countries}
                  applicantDefs={data.fieldDefs.applicant}
                  purpose={travel.purpose}
                  lang={lang}
                  open={openKey === applicant.key}
                  onToggle={() =>
                    setOpenKey((k) => (k === applicant.key ? null : applicant.key))
                  }
                  onChange={(patch) => patchApplicant(applicant.key, patch)}
                  onAnswer={(key, value) => answerApplicant(applicant.key, key, value)}
                  onDocs={(slot, refs) => docsApplicant(applicant.key, slot, refs)}
                  onRemove={() => removeApplicant(applicant.key)}
                  canRemove={applicants.length > 1}
                  error={error}
                  disabled={submitting}
                />
              ))}

              <button
                type="button"
                onClick={addApplicant}
                disabled={submitting || applicants.length >= maxApplicants}
                className="h-11 w-full rounded-xl border border-dashed border-line bg-canvas/50 text-[13px] font-semibold text-brand transition-colors hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applicants.length >= maxApplicants
                  ? t(`Maximum ${maxApplicants} applicants`, `Maksimal ${maxApplicants} pemohon`)
                  : t("+ Add applicant", "+ Tambah pemohon")}
              </button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5">
              <div>
                <h3 className="text-[14px] font-bold text-ink">
                  {t("Additional information", "Informasi tambahan")}
                </h3>
                <p className="mt-0.5 mb-3 text-[12px] text-muted">
                  {t(
                    "Extra details required for this application — once for the whole order.",
                    "Detail tambahan yang diminta untuk pengajuan ini — sekali untuk seluruh pesanan.",
                  )}
                </p>
                {data.fieldDefs.application.length > 0 ? (
                  <DynamicFields
                    defs={data.fieldDefs.application}
                    answers={orderAnswers}
                    onChange={(key, value) =>
                      setOrderAnswers((answers) => ({ ...answers, [key]: value }))
                    }
                    purpose={travel.purpose}
                    lang={lang}
                    disabled={submitting}
                  />
                ) : (
                  <p className="rounded-xl border border-line bg-canvas/50 px-4 py-3 text-[12px] text-muted">
                    {t("No additional fields for now.", "Tidak ada kolom tambahan untuk saat ini.")}
                  </p>
                )}
              </div>

              <label className="block border-t border-line pt-5">
                <span className="mb-1.5 block text-[12px] font-medium text-ink">
                  {t("Note for our team (optional)", "Catatan untuk tim kami (opsional)")}
                </span>
                <textarea
                  rows={3}
                  value={note}
                  disabled={submitting}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t(
                    "Anything we should know — e.g. travelling with children.",
                    "Hal yang perlu kami tahu — mis. bepergian dengan anak-anak.",
                  )}
                  className={AREA_CLASS}
                />
              </label>
            </div>
          ) : null}

          {step === 3 ? (
            <ReviewStep
              travel={travel}
              applicants={applicants}
              data={data}
              orderAnswers={orderAnswers}
              note={note}
              lang={lang}
              confirmed={confirmed}
              onConfirm={setConfirmed}
              onEdit={goTo}
              disabled={submitting || paying}
            />
          ) : null}

          {/* Inline error (client or server) */}
          {error ? (
            <p className="mt-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
              {error.error}
            </p>
          ) : null}
        </div>

        {/* Sticky navigation — sits above the mobile tab bar */}
        <div className="sticky bottom-16 z-10 flex items-center justify-between gap-3 rounded-b-2xl border-t border-line bg-white p-4 sm:px-6 lg:bottom-0">
          <button
            type="button"
            onClick={() => goTo(Math.max(0, step - 1))}
            disabled={step === 0 || submitting}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("Back", "Kembali")}
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-6 text-[14px] font-semibold text-white transition-opacity hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("Continue", "Lanjut")}
            </button>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting || paying || !confirmed}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-6 text-[14px] font-semibold text-white transition-opacity hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting
                  ? t("Submitting…", "Mengirim…")
                  : t("Submit & pay", "Kirim & bayar")}
              </button>
              <PayPalPayButton
                onPay={() => handleSubmit("PAYPAL")}
                busy={submitting || paying}
                disabled={submitting || paying || !confirmed}
                label={t("Pay with PayPal", "Bayar dengan PayPal")}
                processingLabel={t("Preparing…", "Menyiapkan…")}
              />
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {t("How does it work?", "Bagaimana cara kerjanya?")}
          </h2>

          <ol className="mt-4 space-y-4">
            {list.map((item, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-dark">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                    {item.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <p className="mt-5 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
            {t(
              "Applications are processed during business hours. Your application number is created automatically and can be tracked in Orders.",
              "Pengajuan diproses pada jam kerja. Nomor pengajuan otomatis dibuat dan bisa dilacak di halaman Pesanan.",
            )}
          </p>
        </div>
      </aside>
    </div>
  );
}

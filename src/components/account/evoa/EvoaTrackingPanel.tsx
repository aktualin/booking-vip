"use client";

import { useState } from "react";
import {
  EVOA_PURPOSES,
  deriveEvoaOrderStatus,
} from "@/lib/evoa-shared";
import { startBookingPayment } from "@/app/actions/payments";
import { showToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/LocaleProvider";
import PayPalPayButton from "@/components/payment/PayPalPayButton";
import type { EvoaTrackingDTO } from "@/app/actions/evoa-tracking";
import EvoaApplicantCard from "./EvoaApplicantCard";
import EvoaRevisionUpload from "./EvoaRevisionUpload";
import EvoaTimeline from "./EvoaTimeline";
import { AnswerList, DocumentList, StatusBadge, fmtDate, fmtDateTime, pick } from "./shared";

/**
 * The customer's e-VOA tracking panel — everything about one order:
 * payment, timeline, per-person documents and visas, and the revision
 * re-upload flow. Data arrives fully loaded from the server page; after a
 * revision submit the child calls router.refresh() to re-fetch it.
 */
export default function EvoaTrackingPanel({
  tracking,
}: {
  tracking: EvoaTrackingDTO;
}) {
  const { lang, formatMoney } = useLocale();
  const [paying, setPaying] = useState(false);

  // The group status may lead the stored order status (e.g. one person in
  // revision surfaces "revision" for the whole order).
  const displayStatus = deriveEvoaOrderStatus(
    tracking.status,
    tracking.applicants.map((applicant) => applicant.status),
  );

  const purpose = EVOA_PURPOSES.find((p) => p.value === tracking.purpose);
  const pemesanName =
    tracking.contactName ?? tracking.legacy.fullName ?? tracking.email;

  const orderDocuments = tracking.documents.filter(
    (doc) => doc.applicantId === null,
  );
  const applicantNames: Record<string, string> = {};
  for (const applicant of tracking.applicants) {
    applicantNames[applicant.id] = applicant.fullName;
  }

  // Mirror of EvoaApplicantCard's rule — when no person is affected, an
  // order-level revision is handled with order-level documents instead.
  const anyApplicantNeedsRevision = tracking.applicants.some((applicant) => {
    const docs = tracking.documents.filter(
      (doc) => doc.applicantId === applicant.id,
    );
    return (
      applicant.status === "revision" ||
      (tracking.status === "revision" &&
        docs.some((doc) => doc.reviewStatus === "revision"))
    );
  });
  const showOrderRevision =
    tracking.status === "revision" && !anyApplicantNeedsRevision;

  const handlePay = async (methodCode = "CREDIT_CARD") => {
    if (paying || !tracking.booking) return;
    setPaying(true);
    const result = await startBookingPayment({
      bookingCode: tracking.booking.code,
      email: tracking.email,
      methodCode,
    });
    if (result.ok) {
      // Hosted gateway checkout — a full navigation, not a router push.
      window.location.assign(result.checkoutUrl);
      return;
    }
    setPaying(false);
    showToast(result.error, "error");
  };

  const applicationDefs = tracking.fieldDefs.filter(
    (def) => def.scope === "application",
  );

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------- */}
      {/* Order header                                                   */}
      {/* ------------------------------------------------------------- */}
      <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[17px] font-bold tracking-[0.04em] text-ink">
            {tracking.code}
          </p>
          <StatusBadge status={displayStatus} lang={lang} />
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
              {pick(lang, "Kedatangan", "Arrival")}
            </dt>
            <dd className="mt-0.5 text-[13px] font-semibold text-ink">
              {fmtDate(tracking.arrivalDate, lang)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
              {pick(lang, "Total", "Total")}
            </dt>
            <dd className="mt-0.5 text-[13px] font-semibold text-ink">
              {formatMoney(tracking.totalUsdCents / 100)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
              {pick(lang, "Pemesan", "Booked by")}
            </dt>
            <dd className="mt-0.5 text-[13px] font-semibold text-ink">
              {pemesanName}
            </dd>
            <dd className="text-[12px] text-muted">{tracking.email}</dd>
            <dd className="text-[12px] text-muted">{tracking.phone}</dd>
          </div>
        </dl>

        {purpose ? (
          <p className="mt-3 text-[12px] text-muted">
            {pick(lang, "Tujuan kunjungan:", "Purpose of visit:")}{" "}
            <span className="font-medium text-ink">
              {lang === "id" ? purpose.id : purpose.en}
            </span>
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------------- */}
      {/* Payment                                                        */}
      {/* ------------------------------------------------------------- */}
      {tracking.status === "awaiting_payment" ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {pick(lang, "Selesaikan pembayaran", "Complete the payment")}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {pick(
              lang,
              "Pengajuan diproses setelah pembayaran selesai. Kamu akan diarahkan ke halaman pembayaran aman.",
              "The application is processed once the payment is done. You will be redirected to a secure checkout page.",
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={paying || !tracking.booking}
              onClick={() => void handlePay()}
              className="inline-flex h-10 items-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {paying
                ? pick(lang, "Menyiapkan…", "Preparing…")
                : pick(lang, "Selesaikan pembayaran", "Complete payment")}
            </button>
            <PayPalPayButton
              onPay={() => handlePay("PAYPAL")}
              busy={paying}
              disabled={!tracking.booking}
              label={pick(lang, "Bayar dengan PayPal", "Pay with PayPal")}
              processingLabel={pick(lang, "Menyiapkan…", "Preparing…")}
              className="h-10! px-5! text-[13px]!"
            />
            {tracking.payment?.checkoutUrl ? (
              <a
                href={tracking.payment.checkoutUrl}
                className="text-[12px] font-semibold text-brand transition-opacity hover:opacity-80"
              >
                {pick(
                  lang,
                  "Lanjutkan pembayaran yang tertunda",
                  "Resume the pending payment",
                )}
              </a>
            ) : null}
          </div>
          {!tracking.booking ? (
            <p className="mt-3 text-[12px] text-muted">
              {pick(
                lang,
                "Tidak ada tagihan terhubung — tim kami akan menghubungi kamu.",
                "No invoice is linked — our team will contact you.",
              )}
            </p>
          ) : null}
        </section>
      ) : tracking.paidAt ? (
        <p className="flex items-center gap-2 rounded-2xl border border-line bg-white px-5 py-3.5 text-[13px] text-muted">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-soft text-brand-dark">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m5 13 4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          {pick(lang, "Dibayar pada", "Paid on")}{" "}
          <span className="font-medium text-ink">
            {fmtDateTime(tracking.paidAt, lang)}
          </span>
        </p>
      ) : null}

      {/* ------------------------------------------------------------- */}
      {/* Order-level revision note                                      */}
      {/* ------------------------------------------------------------- */}
      {tracking.status === "revision" && tracking.revisionNote ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-[13px] leading-snug text-amber-700">
          <span className="font-semibold">
            {pick(lang, "Perlu revisi:", "Revision requested:")}
          </span>{" "}
          {tracking.revisionNote}
        </p>
      ) : null}

      {/* ------------------------------------------------------------- */}
      {/* Travel plan                                                    */}
      {/* ------------------------------------------------------------- */}
      <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {pick(lang, "Rencana perjalanan", "Travel plan")}
        </h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {tracking.portOfEntryName ? (
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                {pick(lang, "Pintu kedatangan", "Port of entry")}
              </dt>
              <dd className="mt-0.5 text-[13px] text-ink">
                {tracking.portOfEntryName}
              </dd>
            </div>
          ) : null}
          {tracking.flightNumber ? (
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                {pick(lang, "Penerbangan kedatangan", "Arrival flight")}
              </dt>
              <dd className="mt-0.5 font-mono text-[13px] text-ink">
                {tracking.flightNumber}
              </dd>
            </div>
          ) : null}
          {tracking.departureDate ? (
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                {pick(lang, "Keberangkatan", "Departure")}
              </dt>
              <dd className="mt-0.5 text-[13px] text-ink">
                {fmtDate(tracking.departureDate, lang)}
                {tracking.departureFlightNumber ? (
                  <span className="ml-1.5 font-mono text-[12px] text-muted">
                    {tracking.departureFlightNumber}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {tracking.hotelName ? (
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                {pick(lang, "Akomodasi", "Accommodation")}
              </dt>
              <dd className="mt-0.5 text-[13px] text-ink">
                {tracking.hotelName}
                {tracking.hotelCity ? `, ${tracking.hotelCity}` : ""}
              </dd>
              {tracking.hotelAddress ? (
                <dd className="text-[12px] leading-snug text-muted">
                  {tracking.hotelAddress}
                </dd>
              ) : null}
            </div>
          ) : null}
        </dl>
        {tracking.note ? (
          <p className="mt-3 text-[12px] leading-snug text-muted">
            <span className="font-medium text-ink">
              {pick(lang, "Catatan kamu:", "Your note:")}
            </span>{" "}
            {tracking.note}
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------------- */}
      {/* Timeline                                                       */}
      {/* ------------------------------------------------------------- */}
      <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
        <h2 className="mb-4 text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {pick(lang, "Riwayat status", "Status history")}
        </h2>
        <EvoaTimeline events={tracking.events} applicantNames={applicantNames} />
      </section>

      {/* ------------------------------------------------------------- */}
      {/* Applicants (or the legacy single-person fallback)              */}
      {/* ------------------------------------------------------------- */}
      {tracking.applicants.length > 0 ? (
        <section>
          <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {pick(lang, "Pemohon", "Applicants")} ({tracking.applicants.length})
          </h2>
          <div className="space-y-4">
            {tracking.applicants.map((applicant) => (
              <EvoaApplicantCard
                key={applicant.id}
                code={tracking.code}
                applicant={applicant}
                documents={tracking.documents.filter(
                  (doc) => doc.applicantId === applicant.id,
                )}
                fieldDefs={tracking.fieldDefs}
                orderStatus={tracking.status}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {pick(lang, "Data pemohon", "Applicant details")}
          </h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {tracking.legacy.fullName ? (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                  {pick(lang, "Nama lengkap", "Full name")}
                </dt>
                <dd className="mt-0.5 text-[13px] font-semibold text-ink">
                  {tracking.legacy.fullName}
                </dd>
              </div>
            ) : null}
            {tracking.legacy.passportNumber ? (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                  {pick(lang, "Nomor paspor", "Passport number")}
                </dt>
                <dd className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
                  {tracking.legacy.passportNumber}
                </dd>
              </div>
            ) : null}
            {tracking.legacy.nationality ? (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                  {pick(lang, "Kewarganegaraan", "Nationality")}
                </dt>
                <dd className="mt-0.5 text-[13px] text-ink">
                  {tracking.legacy.nationality}
                </dd>
              </div>
            ) : null}
            {tracking.legacy.dateOfBirth ? (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                  {pick(lang, "Tanggal lahir", "Date of birth")}
                </dt>
                <dd className="mt-0.5 text-[13px] text-ink">
                  {fmtDate(tracking.legacy.dateOfBirth, lang)}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* Order-level documents + order-level revision                   */}
      {/* ------------------------------------------------------------- */}
      {orderDocuments.length > 0 || showOrderRevision ? (
        <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
          <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {pick(lang, "Dokumen pesanan", "Order documents")}
          </h2>
          <DocumentList
            documents={orderDocuments}
            lang={lang}
            fieldDefs={tracking.fieldDefs}
          />
          {showOrderRevision ? (
            <EvoaRevisionUpload
              code={tracking.code}
              applicantId={null}
              documents={orderDocuments}
              fieldDefs={tracking.fieldDefs}
            />
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------- */}
      {/* Order-level dynamic answers                                    */}
      {/* ------------------------------------------------------------- */}
      {Object.keys(tracking.extraAnswers).length > 0 ? (
        <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
          <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {pick(lang, "Informasi tambahan", "Additional information")}
          </h2>
          <AnswerList
            answers={tracking.extraAnswers}
            defs={applicationDefs}
            lang={lang}
          />
        </section>
      ) : null}
    </div>
  );
}
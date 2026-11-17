"use client";

import Link from "next/link";
import {
  EVOA_RELATIONS,
  type EvoaDocumentDTO,
} from "@/lib/evoa-shared";
import { useLocale } from "@/components/providers/LocaleProvider";
import type {
  EvoaTrackingApplicantDTO,
  EvoaTrackingFieldDef,
} from "@/app/actions/evoa-tracking";
import EvoaRevisionUpload from "./EvoaRevisionUpload";
import { AnswerList, DocumentList, StatusBadge, fmtDate, pick } from "./shared";

/**
 * One person of the group order: passport data, review state, documents,
 * the issued e-VOA download and — when ops asked for fixes — the revision
 * re-upload flow.
 */
export default function EvoaApplicantCard({
  code,
  applicant,
  documents,
  fieldDefs,
  orderStatus,
}: {
  code: string;
  applicant: EvoaTrackingApplicantDTO;
  /** Only this applicant's documents. */
  documents: EvoaDocumentDTO[];
  fieldDefs: EvoaTrackingFieldDef[];
  orderStatus: string;
}) {
  const { lang } = useLocale();

  const relation = EVOA_RELATIONS.find((r) => r.value === applicant.relation);
  const applicantDefs = fieldDefs.filter((def) => def.scope === "applicant");

  // The person needs fixes when their own status is revision or ops flagged
  // one of their documents — an order-level revision alone does not force
  // every person to re-upload.
  const needsRevision =
    applicant.status === "revision" ||
    (orderStatus === "revision" &&
      documents.some((doc) => doc.reviewStatus === "revision"));

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {applicant.fullName}
          </h3>
          {relation ? (
            <p className="mt-0.5 text-[12px] text-muted">
              {pick(lang, "Hubungan:", "Relation:")}{" "}
              {lang === "id" ? relation.id : relation.en}
            </p>
          ) : null}
        </div>
        <StatusBadge status={applicant.status} lang={lang} />
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            {pick(lang, "Nomor paspor", "Passport number")}
          </dt>
          <dd className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
            {applicant.passportNumber}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            {pick(lang, "Kewarganegaraan", "Nationality")}
          </dt>
          <dd className="mt-0.5 text-[13px] text-ink">
            {applicant.nationalityName}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            {pick(lang, "Tanggal lahir", "Date of birth")}
          </dt>
          <dd className="mt-0.5 text-[13px] text-ink">
            {fmtDate(applicant.dateOfBirth, lang)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
            {pick(lang, "Paspor berlaku sampai", "Passport valid until")}
          </dt>
          <dd className="mt-0.5 text-[13px] text-ink">
            {fmtDate(applicant.passportExpiryDate, lang)}
          </dd>
        </div>
      </dl>

      {applicant.status === "revision" && applicant.revisionNote ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-700">
          <span className="font-semibold">
            {pick(lang, "Catatan revisi:", "Revision note:")}
          </span>{" "}
          {applicant.revisionNote}
        </p>
      ) : null}

      {applicant.extraAnswers &&
      Object.keys(applicant.extraAnswers).length > 0 ? (
        <div className="mt-4">
          <AnswerList
            answers={applicant.extraAnswers}
            defs={applicantDefs}
            lang={lang}
          />
        </div>
      ) : null}

      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-[12px] font-semibold text-ink">
          {pick(lang, "Dokumen", "Documents")}
        </p>
        <DocumentList documents={documents} lang={lang} fieldDefs={fieldDefs} />
      </div>

      {/* The issued e-VOA — private PDF, served through the auth proxy. */}
      {applicant.visaPdfKey ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[13px] font-semibold text-emerald-700">
            {pick(lang, "e-VOA sudah terbit", "e-VOA issued")}
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-emerald-700/80">
                {pick(lang, "Nomor visa", "Visa number")}
              </dt>
              <dd className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
                {applicant.visaNumber ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-emerald-700/80">
                {pick(lang, "Tanggal terbit", "Issued on")}
              </dt>
              <dd className="mt-0.5 text-[13px] text-ink">
                {fmtDate(applicant.issuedAt, lang)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-emerald-700/80">
                {pick(lang, "Berlaku sampai", "Valid until")}
              </dt>
              <dd className="mt-0.5 text-[13px] text-ink">
                {fmtDate(applicant.visaExpiresAt, lang)}
              </dd>
            </div>
          </dl>
          <Link
            href={`/media/${applicant.visaPdfKey}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {pick(lang, "Unduh e-VOA (PDF)", "Download e-VOA (PDF)")}
          </Link>
        </div>
      ) : null}

      {needsRevision ? (
        <EvoaRevisionUpload
          code={code}
          applicantId={applicant.id}
          documents={documents}
          fieldDefs={fieldDefs}
        />
      ) : null}
    </div>
  );
}
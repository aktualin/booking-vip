"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  issueApplicantVisa,
  requestApplicantRevision,
  type EvoaAdminFieldDef,
  type EvoaApplicantAdminDTO,
} from "@/app/actions/evoa-admin";
import { uploadEvoaDoc } from "@/lib/evoa-upload";
import {
  EVOA_GENDERS,
  EVOA_PASSPORT_TYPES,
  EVOA_RELATIONS,
  type EvoaDocumentDTO,
} from "@/lib/evoa-shared";
import { showAdminToast } from "@/components/admin/toast";
import EvoaOrderDocuments from "./EvoaOrderDocuments";
import {
  CopyValue,
  ExtraAnswersView,
  StatusBadge,
  fmtDate,
} from "./EvoaOrderShared";

/**
 * One applicant of an e-VOA order.
 *
 * The data grid follows the OFFICIAL PORTAL field order
 * (evisa.imigrasi.go.id) so ops can copy-paste each value straight into the
 * application form. Below it: the extra answers, the per-person workflow
 * actions (revision / issue visa) and the person's documents.
 */

const BTN_PRIMARY =
  "inline-flex h-9 items-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50";
const BTN_SECONDARY =
  "inline-flex h-9 items-center rounded-xl border border-line bg-white px-4 text-[13px] font-medium text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";
const INPUT_CLASS =
  "h-10 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

function labelOf(
  list: readonly { value: string; id: string }[],
  value: string,
): string {
  return list.find((item) => item.value === value)?.id ?? value;
}

/** yyyy-mm-dd for <input type="date"> defaults. */
function dateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function EvoaApplicantCard({
  applicant,
  index,
  orderStatus,
  fieldDefs,
  documents,
}: {
  applicant: EvoaApplicantAdminDTO;
  index: number;
  orderStatus: string;
  fieldDefs: EvoaAdminFieldDef[];
  documents: EvoaDocumentDTO[];
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");

  const [issuing, setIssuing] = useState(false);
  const [visaNumber, setVisaNumber] = useState(applicant.visaNumber ?? "");
  const [visaExpiry, setVisaExpiry] = useState(dateInputValue(applicant.visaExpiresAt));
  const fileRef = useRef<HTMLInputElement>(null);

  const canRevise = applicant.status !== "issued" && applicant.status !== "rejected";
  const canIssue =
    (orderStatus === "processing" || orderStatus === "issued") &&
    applicant.status !== "rejected";

  const submitRevision = async () => {
    if (busy) return;
    if (!revisionNote.trim()) {
      showAdminToast("Tulis catatan revisi dulu.", "error");
      return;
    }
    setBusy(true);
    const result = await requestApplicantRevision(applicant.id, revisionNote.trim());
    setBusy(false);
    if (result.ok) {
      showAdminToast(`Revisi diminta untuk ${applicant.fullName}.`);
      setRevising(false);
      setRevisionNote("");
      router.refresh();
    } else {
      showAdminToast(result.error, "error");
    }
  };

  const submitIssue = async () => {
    if (busy) return;
    if (!visaNumber.trim()) {
      showAdminToast("Nomor visa wajib diisi.", "error");
      return;
    }

    setBusy(true);
    try {
      // Upload the issued PDF first (admin-only route); when re-issuing
      // without a new file, keep the previously stored key.
      let visaPdfKey = applicant.visaPdfKey ?? "";
      const file = fileRef.current?.files?.[0];
      if (file) {
        const upload = await uploadEvoaDoc(file, "visa-pdf");
        if (!upload.ok) {
          showAdminToast(upload.error, "error");
          return;
        }
        visaPdfKey = upload.key;
      }
      if (!visaPdfKey) {
        showAdminToast("Pilih file PDF visa yang terbit.", "error");
        return;
      }

      const result = await issueApplicantVisa(applicant.id, {
        visaNumber: visaNumber.trim(),
        visaPdfKey,
        visaExpiresAt: visaExpiry || undefined,
      });
      if (result.ok) {
        showAdminToast(`e-VOA ${applicant.fullName} tercatat terbit.`);
        setIssuing(false);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else {
        showAdminToast(result.error, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
          Pemohon {index + 1} · {applicant.fullName}
        </h2>
        <StatusBadge status={applicant.status} />
        <span className="text-[12px] text-muted">
          {labelOf(EVOA_RELATIONS, applicant.relation)}
        </span>
      </div>

      {applicant.revisionNote ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-700">
          <span className="font-semibold">Catatan revisi:</span>{" "}
          {applicant.revisionNote}
        </p>
      ) : null}

      {/* Data in the official portal's field order — copy-paste ready. */}
      <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <CopyValue label="Nama lengkap" value={applicant.fullName} />
        <CopyValue label="Jenis kelamin" value={labelOf(EVOA_GENDERS, applicant.gender)} copyValue={applicant.gender} />
        <CopyValue label="Tanggal lahir" value={fmtDate(applicant.dateOfBirth)} copyValue={applicant.dateOfBirth.slice(0, 10)} />
        <CopyValue label="Tempat lahir" value={applicant.placeOfBirth} />
        <CopyValue label="Kewarganegaraan" value={applicant.nationality} />
        <CopyValue label="Nomor paspor" value={applicant.passportNumber} mono />
        <CopyValue label="Jenis paspor" value={labelOf(EVOA_PASSPORT_TYPES, applicant.passportType)} copyValue={applicant.passportType} />
        <CopyValue label="Negara penerbit paspor" value={applicant.passportIssuingCountry} />
        <CopyValue label="Tanggal terbit paspor" value={fmtDate(applicant.passportIssueDate)} copyValue={applicant.passportIssueDate?.slice(0, 10) ?? ""} />
        <CopyValue label="Tanggal habis paspor" value={fmtDate(applicant.passportExpiryDate)} copyValue={applicant.passportExpiryDate.slice(0, 10)} />
        <CopyValue label="Email" value={applicant.email} />
        <CopyValue label="Telepon" value={applicant.phone} />
        <CopyValue label="Hubungan dengan pemesan" value={labelOf(EVOA_RELATIONS, applicant.relation)} copyValue={applicant.relation} />
      </div>

      {/* Dynamic applicant-scope answers */}
      <div className="mt-4">
        <ExtraAnswersView
          answers={applicant.extraAnswers}
          defs={fieldDefs}
          scope="applicant"
          title="Informasi tambahan pemohon"
        />
      </div>

      {/* Issued visa summary */}
      {applicant.visaNumber ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[12px] font-semibold text-emerald-700">e-VOA terbit</p>
          <div className="mt-1.5 grid gap-x-6 gap-y-1.5 text-[12px] text-ink sm:grid-cols-3">
            <p>
              <span className="text-muted">Nomor visa: </span>
              <span className="font-mono font-semibold">{applicant.visaNumber}</span>
            </p>
            <p>
              <span className="text-muted">Terbit: </span>
              {fmtDate(applicant.issuedAt)}
            </p>
            <p>
              <span className="text-muted">Berlaku hingga: </span>
              {fmtDate(applicant.visaExpiresAt)}
            </p>
          </div>
          {applicant.visaPdfKey ? (
            <p className="mt-1.5 break-all text-[11px] text-muted">
              PDF tersimpan (privat): {applicant.visaPdfKey}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Per-applicant actions */}
      {canRevise || canIssue ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canRevise ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setRevising((value) => !value)}
              className={BTN_SECONDARY}
            >
              Minta revisi
            </button>
          ) : null}
          {canIssue ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setIssuing((value) => !value)}
              className={BTN_PRIMARY}
            >
              {applicant.status === "issued" ? "Perbarui visa" : "Terbitkan visa"}
            </button>
          ) : null}
        </div>
      ) : null}

      {revising ? (
        <div className="mt-3 rounded-xl border border-line bg-canvas p-3">
          <textarea
            value={revisionNote}
            onChange={(event) => setRevisionNote(event.target.value)}
            rows={2}
            placeholder="Contoh: nama di paspor berbeda dengan data yang diisi…"
            className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-brand"
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={busy} onClick={submitRevision} className={BTN_PRIMARY}>
              {busy ? "Mengirim…" : "Kirim revisi"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRevising(false);
                setRevisionNote("");
              }}
              className={BTN_SECONDARY}
            >
              Batal
            </button>
          </div>
        </div>
      ) : null}

      {issuing ? (
        <div className="mt-3 rounded-xl border border-line bg-canvas p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px] font-medium text-ink">
              Nomor visa
              <input
                value={visaNumber}
                onChange={(event) => setVisaNumber(event.target.value)}
                placeholder="Nomor e-VOA dari portal resmi"
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </label>
            <label className="block text-[12px] font-medium text-ink">
              Berlaku hingga (opsional)
              <input
                type="date"
                value={visaExpiry}
                onChange={(event) => setVisaExpiry(event.target.value)}
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </label>
          </div>
          <label className="mt-3 block text-[12px] font-medium text-ink">
            PDF visa terbit
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="mt-1.5 block w-full text-[12px] text-muted file:mr-3 file:h-9 file:rounded-xl file:border-0 file:bg-brand-soft file:px-3 file:text-[12px] file:font-semibold file:text-brand-dark hover:file:bg-brand/15"
            />
          </label>
          <p className="mt-1.5 text-[12px] text-muted">
            Kosongkan tanggal berlaku untuk memakai default 90 hari sejak
            terbit. Tanpa file baru, PDF sebelumnya tetap dipakai.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button type="button" disabled={busy} onClick={submitIssue} className={BTN_PRIMARY}>
              {busy ? "Mengunggah & menyimpan…" : "Simpan visa terbit"}
            </button>
            <button type="button" onClick={() => setIssuing(false)} className={BTN_SECONDARY}>
              Batal
            </button>
          </div>
        </div>
      ) : null}

      {/* This person's documents */}
      <div className="mt-4">
        <EvoaOrderDocuments
          documents={documents}
          fieldDefs={fieldDefs}
          title="Dokumen pemohon"
        />
      </div>
    </section>
  );
}
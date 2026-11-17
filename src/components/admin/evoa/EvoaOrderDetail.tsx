"use client";

import Link from "next/link";
import { EVOA_PURPOSES } from "@/lib/evoa-shared";
import type { EvoaOrderAdminDTO as OrderDTO } from "@/app/actions/evoa-admin";
import EvoaApplicantCard from "./EvoaApplicantCard";
import EvoaOrderActions from "./EvoaOrderActions";
import EvoaOrderDocuments from "./EvoaOrderDocuments";
import EvoaOrderTimeline from "./EvoaOrderTimeline";
import {
  CopyValue,
  ExtraAnswersView,
  StatusBadge,
  fmtDate,
  fmtDateTime,
  fmtUsd,
} from "./EvoaOrderShared";

/**
 * The full admin view of one e-VOA order: summary, workflow actions,
 * per-applicant cards (portal-order data + issue form + documents),
 * order-level documents and the audit timeline.
 *
 * Data arrives from the server page (`getEvoaOrderAdmin`); every mutation
 * calls `router.refresh()` so the server re-reads the fresh state.
 */

function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
        {label}
      </p>
      <p className="mt-0.5 break-words text-[13px] text-ink">{children}</p>
    </div>
  );
}

export default function EvoaOrderDetail({ order }: { order: OrderDTO }) {
  const purposeLabel =
    EVOA_PURPOSES.find((item) => item.value === order.purpose)?.id ??
    order.purpose ??
    "—";

  const orderDocuments = order.documents.filter((doc) => doc.applicantId === null);
  const isLegacy = order.applicants.length === 0 && Boolean(order.legacy.fullName);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/admin/visa"
          className="text-[13px] text-muted transition-colors hover:text-ink"
        >
          ← Kembali ke daftar pengajuan
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-[22px] font-bold tracking-[0.02em] text-ink">
            {order.code}
          </h1>
          <StatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-[12px] text-muted">
          Dibuat {fmtDateTime(order.createdAt)}
          {order.paidAt ? ` · Dibayar ${fmtDateTime(order.paidAt)}` : ""}
          {order.processingAt ? ` · Diproses ${fmtDateTime(order.processingAt)}` : ""}
          {order.completedAt ? ` · Selesai ${fmtDateTime(order.completedAt)}` : ""}
        </p>
      </div>

      {/* Order summary */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
          Ringkasan pesanan
        </h2>

        {order.revisionNote ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-700">
            <span className="font-semibold">Revisi diminta:</span>{" "}
            {order.revisionNote}
          </p>
        ) : null}

        <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryItem label="Pemesan">
            {order.contactName ?? order.legacy.fullName ?? "—"}
          </SummaryItem>
          <SummaryItem label="Email">{order.email}</SummaryItem>
          <SummaryItem label="Telepon">{order.phone}</SummaryItem>
          <SummaryItem label="Tujuan kunjungan">{purposeLabel}</SummaryItem>
          <SummaryItem label="Kedatangan">
            {fmtDate(order.arrivalDate)}
            {order.flightNumber ? ` · ${order.flightNumber}` : ""}
            {order.portOfEntryName ? ` · TPI ${order.portOfEntryName}` : ""}
          </SummaryItem>
          <SummaryItem label="Kepulangan">
            {order.departureDate
              ? `${fmtDate(order.departureDate)}${
                  order.departureFlightNumber ? ` · ${order.departureFlightNumber}` : ""
                }`
              : "—"}
          </SummaryItem>
          <SummaryItem label="Total">{fmtUsd(order.totalUsdCents)}</SummaryItem>
          <SummaryItem label="Ref transaksi portal resmi">
            {order.officialTransactionRef ? (
              <span className="font-mono">{order.officialTransactionRef}</span>
            ) : (
              "—"
            )}
          </SummaryItem>
        </div>

        {/* Accommodation block */}
        {order.hotelName || order.hotelAddress || order.hotelCity ? (
          <div className="mt-4 rounded-xl border border-line bg-canvas p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              Akomodasi
            </p>
            <p className="mt-1 text-[13px] font-medium text-ink">
              {order.hotelName ?? "—"}
            </p>
            <p className="text-[12px] leading-snug text-muted">
              {[order.hotelAddress, order.hotelCity, order.hotelPostalCode]
                .filter(Boolean)
                .join(", ") || "—"}
            </p>
          </div>
        ) : null}

        {order.note ? (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              Catatan pemesan
            </p>
            <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink">
              {order.note}
            </p>
          </div>
        ) : null}

        {/* Application-scope dynamic answers */}
        <div className="mt-4">
          <ExtraAnswersView
            answers={order.extraAnswers}
            defs={order.fieldDefs}
            scope="application"
            title="Informasi tambahan pesanan"
          />
        </div>

        {/* Booking / payment */}
        {order.booking || order.payment ? (
          <div className="mt-4 rounded-xl border border-line bg-canvas p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              Booking & pembayaran
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-ink">
              {order.booking ? (
                <span>
                  Booking{" "}
                  <span className="font-mono font-semibold">{order.booking.code}</span>{" "}
                  · {order.booking.status}
                </span>
              ) : null}
              {order.payment ? (
                <span>
                  Pembayaran: <span className="font-medium">{order.payment.status}</span>
                  {order.payment.provider ? ` · ${order.payment.provider}` : ""}
                </span>
              ) : null}
              {order.payment?.checkoutUrl ? (
                <a
                  href={order.payment.checkoutUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand-dark underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
                >
                  Buka halaman pembayaran ↗
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {/* Workflow actions */}
      <EvoaOrderActions order={order} />

      {/* Legacy fallback — old single-applicant rows stay viewable */}
      {isLegacy ? (
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            Data pemohon (format lama)
          </h2>
          <p className="mt-1 text-[12px] text-muted">
            Pesanan ini dibuat sebelum model per-pemohon — datanya tersimpan
            di kolom lama.
          </p>
          <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <CopyValue label="Nama lengkap" value={order.legacy.fullName ?? ""} />
            <CopyValue label="Nomor paspor" value={order.legacy.passportNumber ?? ""} mono />
            <CopyValue label="Kewarganegaraan" value={order.legacy.nationality ?? ""} />
            <CopyValue
              label="Tanggal lahir"
              value={fmtDate(order.legacy.dateOfBirth)}
              copyValue={order.legacy.dateOfBirth?.slice(0, 10) ?? ""}
            />
          </div>
        </section>
      ) : null}

      {/* Applicants */}
      {order.applicants.map((applicant, index) => (
        <EvoaApplicantCard
          key={applicant.id}
          applicant={applicant}
          index={index}
          orderStatus={order.status}
          fieldDefs={order.fieldDefs}
          documents={order.documents.filter((doc) => doc.applicantId === applicant.id)}
        />
      ))}

      {/* Order-level documents (no applicant) */}
      {orderDocuments.length > 0 ? (
        <section className="rounded-2xl border border-line bg-white p-5">
          <EvoaOrderDocuments
            documents={orderDocuments}
            fieldDefs={order.fieldDefs}
            title="Dokumen pesanan"
          />
        </section>
      ) : null}

      {/* Audit trail */}
      <EvoaOrderTimeline
        events={order.events}
        applicants={order.applicants.map((person) => ({
          id: person.id,
          fullName: person.fullName,
        }))}
      />
    </div>
  );
}
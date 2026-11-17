"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  appendOpsNote,
  assignBooking,
  confirmBooking,
  confirmPaymentManually,
  getAdminBooking,
  listAssignmentOptions,
  listDeparturesForBooking,
  rescheduleBooking,
  setBookingStatus,
} from "@/app/actions/admin-bookings";
import type { AdminBookingDetailFull, AssignmentOptions } from "@/types/admin-bookings";
import type { TourDepartureDTO } from "@/types/tour";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";
import { useAdminValue } from "@/components/admin/useAdminList";
import { formatDateLabel, usd } from "@/lib/format";
import { BookingStatusBadge } from "../BookingsManager";

function dateTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapsUrl(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function waUrl(countryCode: string, phone: string): string {
  const digits = `${countryCode}${phone}`.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-[12px] text-[var(--admin-muted)]">{label}</span>
      <span className="text-right text-[13px]">{children}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${adminClass.panel} px-4 py-3`}>
      <h3 className={adminClass.label}>{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * The transaction detail — summary, contact, money, payment, the tour
 * operations panel (departure, driver/vehicle assignment, reschedule) and
 * the status lifecycle actions.
 */
export default function BookingDetailManager({ id }: { id: string }) {
  const load = useCallback(() => getAdminBooking(id), [id]);
  const { data: booking, loading, error, reload } = useAdminValue<AdminBookingDetailFull | null>(load);

  const isTour = booking?.lineSlug === "tour-package";
  const isJoinIn = booking?.tourKind === "join_in";

  const loadOptions = useCallback(
    () => (isTour ? listAssignmentOptions() : Promise.resolve<AssignmentOptions>({ drivers: [], vehicles: [] })),
    [isTour],
  );
  const { data: options } = useAdminValue<AssignmentOptions>(loadOptions);

  const loadDepartures = useCallback(
    () => (isJoinIn ? listDeparturesForBooking(id) : Promise.resolve<TourDepartureDTO[]>([])),
    [isJoinIn, id],
  );
  const { data: departures } = useAdminValue<TourDepartureDTO[]>(loadDepartures);

  // Assignment + reschedule form state, synced when the booking loads.
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newDepartureId, setNewDepartureId] = useState("");
  const [opsNote, setOpsNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!booking) return;
    setDriverId(booking.driver?.id ?? "");
    setVehicleId(booking.vehicle?.id ?? "");
    setNewDepartureId(booking.departure?.id ?? "");
    setNewDate(booking.serviceAt.slice(0, 16));
  }, [booking]);

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    setBusy(true);
    try {
      const result = await action();
      if (result.ok) {
        showAdminToast(success);
        reload();
      } else {
        showAdminToast(result.error, "error");
      }
    } catch (err) {
      showAdminToast(err instanceof Error ? err.message : "Terjadi kesalahan", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="px-2 py-10 text-[13px] text-[var(--admin-muted)]">Memuat…</p>;
  }
  if (error) {
    return <p className={`${adminClass.panel} px-3 py-2 text-[12px] text-danger`}>{error}</p>;
  }
  if (!booking) {
    return (
      <div className={`${adminClass.panel} px-6 py-12 text-center`}>
        <p className="text-[15px] font-semibold">Booking tidak ditemukan</p>
        <Link href="/admin/bookings" className="mt-3 inline-block text-[13px] underline">
          ← Kembali ke Transaksi
        </Link>
      </div>
    );
  }

  const pickupMap = mapsUrl(booking.pickupLat, booking.pickupLng);
  const dropoffMap = mapsUrl(booking.dropoffLat, booking.dropoffLng);
  const terminal = booking.status === "cancelled" || booking.status === "completed";
  const paymentPending = booking.payment?.status === "pending";

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/bookings" className="text-[12px] text-[var(--admin-muted)] hover:underline">
            ← Transaksi
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h2 className={adminClass.h1}>{booking.code}</h2>
            <BookingStatusBadge status={booking.status} />
          </div>
          <p className="mt-1 text-[12px] text-[var(--admin-muted)]">
            Dibuat {dateTimeLabel(booking.createdAt)}
            {booking.lineLabel ? ` · ${booking.lineLabel}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/voucher/${booking.code}`}
            target="_blank"
            rel="noreferrer"
            className={adminClass.buttonSecondary}
          >
            Voucher
          </a>
          {booking.invoiceNumber ? (
            <a
              href={`/invoice/${booking.code}`}
              target="_blank"
              rel="noreferrer"
              className={adminClass.buttonSecondary}
            >
              Invoice
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Ringkasan */}
        <Panel title="Ringkasan">
          <Row label="Tanggal layanan">{dateTimeLabel(booking.serviceAt)}</Row>
          <Row label="Produk">
            {booking.items.map((item) => (
              <span key={item.productId} className="block">
                {item.productTitle ?? item.label}
                {item.packageLabel ? (
                  <span className="text-[var(--admin-muted)]"> · {item.packageLabel}</span>
                ) : null}
              </span>
            ))}
          </Row>
          <Row label="Penumpang">
            {booking.adultCount} dewasa / {booking.childCount} anak / {booking.infantCount} infant
          </Row>
          {booking.hotelName ? <Row label="Hotel / jemput">{booking.hotelName}</Row> : null}
          {booking.pickupLabel ? (
            <Row label="Pickup">
              {booking.pickupLabel}
              {pickupMap ? (
                <>
                  {" "}
                  <a href={pickupMap} target="_blank" rel="noreferrer" className="underline">
                    peta
                  </a>
                </>
              ) : null}
            </Row>
          ) : null}
          {booking.dropoffLabel ? (
            <Row label="Dropoff">
              {booking.dropoffLabel}
              {dropoffMap ? (
                <>
                  {" "}
                  <a href={dropoffMap} target="_blank" rel="noreferrer" className="underline">
                    peta
                  </a>
                </>
              ) : null}
            </Row>
          ) : null}
          {booking.driverOption ? (
            <Row label="Opsi driver">{booking.driverOption === "with_driver" ? "Dengan driver" : "Tanpa driver"}</Row>
          ) : null}
          {booking.flight?.flightCode ? (
            <Row label="Penerbangan">
              {booking.flight.airline ?? ""} {booking.flight.flightCode}
              {booking.flight.direction ? ` (${booking.flight.direction})` : ""}
            </Row>
          ) : null}
        </Panel>

        {/* Kontak */}
        <Panel title="Kontak">
          {booking.contact ? (
            <>
              <Row label="Nama">
                {booking.contact.title ? `${booking.contact.title} ` : ""}
                {booking.contact.firstName} {booking.contact.lastName}
              </Row>
              <Row label="Email">{booking.contact.email}</Row>
              <Row label="Telepon">
                {booking.contact.phoneCountryCode} {booking.contact.phone}{" "}
                <a
                  href={waUrl(booking.contact.phoneCountryCode, booking.contact.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  WA
                </a>
              </Row>
              {booking.contact.nationality ? (
                <Row label="Kewarganegaraan">{booking.contact.nationality}</Row>
              ) : null}
              {booking.contact.identityNumber ? (
                <Row label="Identitas">
                  {booking.contact.idType?.toUpperCase() ?? "ID"} · {booking.contact.identityNumber}
                </Row>
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-[var(--admin-muted)]">Tidak ada data kontak.</p>
          )}
        </Panel>

        {/* Rincian biaya */}
        <Panel title="Rincian Biaya">
          {booking.items.map((item, index) => (
            <Row key={`${item.productId}-${index}`} label={item.packageLabel ?? item.label}>
              {usd(item.totalUsdCents / 100)}
            </Row>
          ))}
          {booking.addOns.map((addOn, index) => (
            <Row key={`${addOn.label}-${index}`} label={`${addOn.label} ×${addOn.quantity}`}>
              {usd(addOn.totalUsdCents / 100)}
            </Row>
          ))}
          {booking.discountUsdCents > 0 ? (
            <Row label={`Diskon${booking.promoCode ? ` (${booking.promoCode})` : ""}`}>
              −{usd(booking.discountUsdCents / 100)}
            </Row>
          ) : null}
          {booking.taxUsdCents > 0 ? (
            <Row label="Pajak">{usd(booking.taxUsdCents / 100)}</Row>
          ) : null}
          <div className="mt-2 flex items-center justify-between border-t border-[var(--admin-line)] pt-2">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--admin-muted)]">
              Total
            </span>
            <span className="text-[15px] font-semibold tabular-nums">
              {usd(booking.totalUsdCents / 100)}
            </span>
          </div>
        </Panel>

        {/* Pembayaran */}
        <Panel title="Pembayaran">
          {booking.payment ? (
            <>
              <Row label="Status">{booking.payment.status}</Row>
              <Row label="Metode">{booking.payment.methodLabel ?? "—"}</Row>
              <Row label="Jumlah">{usd(booking.payment.amountUsdCents / 100)}</Row>
              {booking.payment.provider ? (
                <Row label="Provider">{booking.payment.provider}</Row>
              ) : null}
              {booking.payment.reference ? (
                <Row label="Referensi">{booking.payment.reference}</Row>
              ) : null}
              {booking.payment.paidAt ? (
                <Row label="Dibayar">{dateTimeLabel(booking.payment.paidAt)}</Row>
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-[var(--admin-muted)]">Belum ada pembayaran.</p>
          )}
          {!terminal && paymentPending ? (
            <button
              type="button"
              className={`${adminClass.buttonSecondary} mt-2`}
              disabled={busy}
              onClick={() =>
                run(() => confirmPaymentManually(booking.id), "Pembayaran manual dikonfirmasi — booking lunas.")
              }
            >
              Konfirmasi pembayaran manual (transfer offline)
            </button>
          ) : null}
          {booking.status === "awaiting_payment" && booking.payment?.status === "paid" ? (
            <button
              type="button"
              className={`${adminClass.buttonPrimary} mt-2`}
              disabled={busy}
              onClick={() => run(() => confirmBooking(booking.id), "Booking dikonfirmasi.")}
            >
              Konfirmasi booking (sudah lunas)
            </button>
          ) : null}
        </Panel>

        {/* Tour operations */}
        {isTour ? (
          <Panel title="Operasional Tour">
            {booking.departure ? (
              <>
                <Row label="Jadwal (join-in)">
                  {formatDateLabel(booking.departure.date.slice(0, 10))} · {booking.departure.startTime}
                </Row>
                <Row label="Kuota">
                  {booking.departure.reserved}/{booking.departure.quota} terisi · sisa{" "}
                  {booking.departure.available}
                </Row>
                <Row label="Status jadwal">{booking.departure.status}</Row>
              </>
            ) : (
              <Row label="Tipe">{booking.tourKind === "private" ? "Private (per mobil)" : "—"}</Row>
            )}
            <Row label="Driver">
              {booking.driver ? (
                <>
                  {booking.driver.name}{" "}
                  <a
                    href={`https://wa.me/${booking.driver.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    WA
                  </a>
                </>
              ) : (
                "Belum di-assign"
              )}
            </Row>
            <Row label="Mobil">
              {booking.vehicle
                ? `${booking.vehicle.name}${booking.vehicle.plateNumber ? ` · ${booking.vehicle.plateNumber}` : ""} (${booking.vehicle.seats} kursi)`
                : "Belum di-assign"}
            </Row>

            {!terminal ? (
              <div className="mt-3 space-y-2 border-t border-[var(--admin-line)] pt-3">
                <p className={adminClass.label}>Assign driver &amp; mobil</p>
                <div className="flex flex-wrap gap-2">
                  <select
                    className={`${adminClass.input} w-auto min-w-[180px] flex-1`}
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    aria-label="Pilih driver"
                  >
                    <option value="">— Tanpa driver —</option>
                    {(options?.drivers ?? []).map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name}
                        {driver.languages ? ` (${driver.languages})` : ""}
                      </option>
                    ))}
                  </select>
                  <select
                    className={`${adminClass.input} w-auto min-w-[180px] flex-1`}
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    aria-label="Pilih mobil"
                  >
                    <option value="">— Tanpa mobil —</option>
                    {(options?.vehicles ?? []).map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.name} · {vehicle.seats} kursi
                        {vehicle.plateNumber ? ` · ${vehicle.plateNumber}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={adminClass.buttonPrimary}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          assignBooking(booking.id, {
                            driverId: driverId || null,
                            vehicleId: vehicleId || null,
                          }),
                        "Assignment disimpan.",
                      )
                    }
                  >
                    Simpan assignment
                  </button>
                </div>

                <p className={`${adminClass.label} pt-2`}>Jadwalkan ulang</p>
                <div className="flex flex-wrap gap-2">
                  {isJoinIn ? (
                    <select
                      className={`${adminClass.input} w-auto min-w-[240px] flex-1`}
                      value={newDepartureId}
                      onChange={(e) => setNewDepartureId(e.target.value)}
                      aria-label="Pilih jadwal baru"
                    >
                      <option value="">— Pilih jadwal —</option>
                      {(departures ?? []).map((dep) => (
                        <option
                          key={dep.id}
                          value={dep.id}
                          disabled={dep.available <= 0 && dep.id !== booking.departure?.id}
                        >
                          {formatDateLabel(dep.date.slice(0, 10))} · {dep.startTime} · sisa{" "}
                          {dep.available}/{dep.quota}
                          {dep.status !== "open" ? " (ditutup)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="datetime-local"
                      className={`${adminClass.input} w-auto`}
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      aria-label="Tanggal baru"
                    />
                  )}
                  <button
                    type="button"
                    className={adminClass.buttonSecondary}
                    disabled={busy || (isJoinIn ? !newDepartureId : !newDate)}
                    onClick={() =>
                      run(
                        () =>
                          rescheduleBooking(booking.id, {
                            serviceAt: newDate ? new Date(newDate).toISOString() : undefined,
                            departureId: isJoinIn ? newDepartureId || null : undefined,
                          }),
                        "Jadwal booking diperbarui.",
                      )
                    }
                  >
                    Reschedule
                  </button>
                </div>
              </div>
            ) : null}
          </Panel>
        ) : null}

        {/* Catatan */}
        <Panel title="Catatan">
          {booking.notes ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-[var(--admin-hover)] px-3 py-2 font-sans text-[12px]">
              {booking.notes}
            </pre>
          ) : (
            <p className="text-[13px] text-[var(--admin-muted)]">Belum ada catatan.</p>
          )}
          {!terminal ? (
            <div className="mt-2 flex gap-2">
              <input
                className={adminClass.input}
                placeholder="Catatan internal ops… (prefix [OPS])"
                value={opsNote}
                onChange={(e) => setOpsNote(e.target.value)}
                maxLength={500}
              />
              <button
                type="button"
                className={adminClass.buttonSecondary}
                disabled={busy || !opsNote.trim()}
                onClick={async () => {
                  await run(() => appendOpsNote(booking.id, opsNote), "Catatan ops ditambahkan.");
                  setOpsNote("");
                }}
              >
                Tambah
              </button>
            </div>
          ) : null}
        </Panel>
      </div>

      {/* Status lifecycle */}
      {!terminal ? (
        <div className={`${adminClass.panel} mt-4 flex flex-wrap items-center gap-2 px-4 py-3`}>
          <span className={`${adminClass.label} mr-2`}>Aksi status</span>
          {booking.status === "confirmed" ? (
            <button
              type="button"
              className={adminClass.buttonPrimary}
              disabled={busy}
              onClick={() => run(() => setBookingStatus(booking.id, "completed"), "Booking ditandai selesai.")}
            >
              Tandai Selesai
            </button>
          ) : null}
          <button
            type="button"
            className={`${adminClass.buttonSecondary} text-danger`}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Batalkan booking ${booking.code}? Kuota/kursi akan dilepas otomatis.`)) {
                run(() => setBookingStatus(booking.id, "cancelled"), "Booking dibatalkan.");
              }
            }}
          >
            Batalkan Booking
          </button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

// The tour e-voucher. Ownership is proven server-side: the signed-in owner
// of the booking needs no email; guests use the contact email (from the
// query string, the browser's last-booking record, or the form below).
// Bilingual inline copy — Indonesian primary, English via the toggle.
// Print-friendly: the toolbar hides itself and the sheet prints clean.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getTourVoucher, type TourVoucherDTO } from "@/app/actions/booking";
import { useLocale } from "@/components/providers/LocaleProvider";

const LAST_BOOKING_KEY = "booking-vip:last-booking";

type Lang = "id" | "en";

/** The status badge copy + tone per booking status. */
function statusMeta(status: string, lang: Lang) {
  switch (status) {
    case "confirmed":
      return {
        label: lang === "id" ? "Dikonfirmasi" : "Confirmed",
        className: "bg-success/10 text-success",
      };
    case "completed":
      return {
        label: lang === "id" ? "Selesai" : "Completed",
        className: "bg-brand-soft text-brand-dark",
      };
    case "cancelled":
      return {
        label: lang === "id" ? "Dibatalkan" : "Cancelled",
        className: "bg-danger/10 text-danger",
      };
    default:
      return {
        label: lang === "id" ? "Menunggu pembayaran" : "Awaiting payment",
        className: "bg-accent/25 text-ink",
      };
  }
}

export default function TourVoucherClient({
  code,
  initialEmail,
}: {
  code: string;
  initialEmail: string;
}) {
  const { formatMoney } = useLocale();
  const [lang, setLang] = useState<Lang>("id");
  const [email, setEmail] = useState(initialEmail);
  const [voucher, setVoucher] = useState<TourVoucherDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Inline bilingual copy — ID primary, EN secondary. */
  const L = (id: string, en: string) => (lang === "id" ? id : en);

  const load = useCallback(
    async (address: string) => {
      setLoading(true);
      setError(null);
      const result = await getTourVoucher(code, address);
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setVoucher(result.voucher);
      setLoading(false);
    },
    [code],
  );

  // Try the query-string email, then the last booking stored in the
  // browser; with neither, the call still succeeds for the signed-in owner.
  useEffect(() => {
    let cancelled = false;

    let address = initialEmail;
    if (!address) {
      try {
        const raw = localStorage.getItem(LAST_BOOKING_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { code?: string; email?: string };
          if (parsed.email && parsed.code === code) address = parsed.email;
        }
      } catch {
        // Storage unavailable — the email is asked for below.
      }
    }

    void (async () => {
      const result = await getTourVoucher(code, address);
      if (cancelled) return;
      if (result.ok) {
        setVoucher(result.voucher);
        setLoading(false);
        return;
      }
      // No access yet — show the email form (guests only; the signed-in
      // owner would already have loaded the voucher above).
      setError(address ? result.error : null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [code, initialEmail]);

  /* ----------------------------------------------------------------- */
  /* Loading                                                            */
  /* ----------------------------------------------------------------- */
  if (loading) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center print:hidden">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            className="animate-spin text-brand-dark"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </span>
        <p className="mt-4 text-[13px] text-muted">
          {L("Memuat e-voucher…", "Loading e-voucher…")}
        </p>
      </div>
    );
  }

  /* ----------------------------------------------------------------- */
  /* Email form (guest ownership proof / retry after an error)          */
  /* ----------------------------------------------------------------- */
  if (!voucher) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center print:hidden">
        <h1 className="text-[20px] font-bold tracking-[-0.01em] text-ink">
          {L("E-voucher pesanan", "Booking e-voucher")}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {L(
            "Masukkan email yang dipakai saat memesan untuk membuka e-voucher",
            "Enter the email used at booking to open the e-voucher",
          )}{" "}
          <span className="font-mono font-semibold text-ink">{code}</span>.
        </p>

        <form
          className="mt-6 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void load(email.trim());
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={L("Email yang dipakai saat memesan", "Email used at booking")}
            className="h-11 flex-1 rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
          />
          <button
            type="submit"
            className="h-11 rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
          >
            {L("Buka voucher", "Open voucher")}
          </button>
        </form>

        {error ? (
          <p className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  /* ----------------------------------------------------------------- */
  /* The voucher sheet                                                  */
  /* ----------------------------------------------------------------- */
  const status = statusMeta(voucher.status, lang);
  const paid = voucher.paymentStatus === "paid";
  const serviceDate = new Date(voucher.serviceAt);
  const dateLabel = Number.isFinite(serviceDate.getTime())
    ? new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(serviceDate)
    : voucher.serviceAt;
  // Join-in tours show the departure's start time; the server already
  // folded it into serviceAt, the departure row is the source of truth.
  const timeLabel = voucher.departure?.startTime ?? null;
  const tourTitle =
    lang === "id" && voucher.tourTitleId ? voucher.tourTitleId : voucher.tourTitle;
  const mapsUrl =
    voucher.pickupLat != null && voucher.pickupLng != null
      ? `https://www.google.com/maps?q=${voucher.pickupLat},${voucher.pickupLng}`
      : null;
  const waUrl = voucher.driver
    ? `https://wa.me/${voucher.driver.phone.replace(/\D/g, "")}`
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Toolbar — never printed */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-white p-0.5">
          {(["id", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`h-8 rounded-md px-3 text-[12px] font-semibold uppercase transition-colors ${
                lang === l ? "bg-brand text-white" : "text-muted hover:bg-canvas"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          {L("Cetak / Print", "Cetak / Print")}
        </button>
      </div>

      {/* The sheet */}
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
        {/* Header: code + status */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
              {L("E-voucher tur", "Tour e-voucher")}
            </p>
            <p className="mt-1 font-mono text-[26px] font-extrabold tracking-tight text-ink">
              {voucher.code}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">
              {L("Atas nama", "Booked by")}{" "}
              <span className="font-semibold text-ink">{voucher.contactName}</span>
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${status.className}`}>
            {status.label}
          </span>
        </div>

        {/* Tour + package */}
        <div className="border-b border-line py-5">
          <h1 className="text-[18px] font-extrabold tracking-[-0.01em] text-ink">
            {tourTitle}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {voucher.packageLabel ? `${L("Paket", "Package")}: ${voucher.packageLabel}` : null}
            {voucher.packageLabel && voucher.durationDays > 0 ? " · " : null}
            {voucher.durationDays > 0
              ? `${voucher.durationDays} ${L("hari", "day(s)")}`
              : null}
            {voucher.tourKind === "join_in" ? " · Join-in" : null}
            {voucher.tourKind === "private" ? ` · ${L("Tur privat", "Private tour")}` : null}
          </p>
        </div>

        {/* Details grid */}
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-line py-5 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">
              {L("Tanggal & jam", "Date & time")}
            </dt>
            <dd className="mt-1 text-[14px] font-semibold text-ink">
              {dateLabel}
              {timeLabel ? ` · ${timeLabel} WIB` : null}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">
              {L("Jumlah penumpang", "Passengers")}
            </dt>
            <dd className="mt-1 text-[14px] font-semibold text-ink">
              {voucher.adultCount} {L("dewasa", "adult(s)")}
              {voucher.childCount > 0 ? ` · ${voucher.childCount} ${L("anak", "child(ren)")}` : ""}
              {voucher.infantCount > 0 ? ` · ${voucher.infantCount} ${L("bayi", "infant(s)")}` : ""}
            </dd>
          </div>
          {voucher.hotelName ? (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">
                {L("Hotel / titik jemput", "Hotel / pickup point")}
              </dt>
              <dd className="mt-1 text-[14px] font-semibold text-ink">{voucher.hotelName}</dd>
            </div>
          ) : null}
          {voucher.pickupLabel ? (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">
                {L("Lokasi penjemputan", "Pickup location")}
              </dt>
              <dd className="mt-1 text-[14px] font-semibold text-ink">
                {voucher.pickupLabel}
                {mapsUrl ? (
                  <>
                    {" "}
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] font-semibold text-brand underline print:hidden"
                    >
                      {L("Buka Google Maps", "Open Google Maps")}
                    </a>
                    <span className="hidden text-[11px] text-muted print:inline"> ({mapsUrl})</span>
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
          {voucher.vehicle ? (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">
                {L("Kendaraan", "Vehicle")}
              </dt>
              <dd className="mt-1 text-[14px] font-semibold text-ink">
                {voucher.vehicle.name}
                {voucher.vehicle.plateNumber ? ` · ${voucher.vehicle.plateNumber}` : ""}
              </dd>
            </div>
          ) : null}
          {/* Driver contact — only present once confirmed AND assigned. */}
          {voucher.driver ? (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">
                {L("Driver / pemandu", "Driver / guide")}
              </dt>
              <dd className="mt-1 text-[14px] font-semibold text-ink">
                {voucher.driver.name}
                {waUrl ? (
                  <>
                    {" "}
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] font-semibold text-success underline print:hidden"
                    >
                      WhatsApp
                    </a>
                    <span className="hidden text-[11px] text-muted print:inline">
                      {" "}({voucher.driver.phone})
                    </span>
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>

        {/* Itinerary summary */}
        {voucher.itinerary.length > 0 ? (
          <div className="border-b border-line py-5">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-muted">
              {L("Ringkasan itinerary", "Itinerary summary")}
            </h2>
            <div className="mt-3 space-y-4">
              {voucher.itinerary.map((day) => (
                <div key={day.day}>
                  <p className="text-[13px] font-bold text-ink">
                    {L(`Hari ${day.day}`, `Day ${day.day}`)}
                    {" — "}
                    {lang === "id" && day.titleId ? day.titleId : day.title}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {(day.items ?? []).map((item, i) => (
                      <li key={i} className="flex gap-3 text-[13px] text-ink">
                        <span className="w-12 shrink-0 font-mono text-muted">{item.time}</span>
                        <span>{lang === "id" && item.activityId ? item.activityId : item.activity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Payment summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
              {L("Total pembayaran", "Payment total")}
            </p>
            <p className="mt-1 text-[20px] font-extrabold text-ink">
              {formatMoney(voucher.totalUsdCents / 100)}
            </p>
            <p className={`mt-0.5 text-[12px] font-semibold ${paid ? "text-success" : "text-muted"}`}>
              {paid
                ? L("Lunas — pembayaran diterima", "Paid — payment received")
                : L("Menunggu pembayaran", "Awaiting payment")}
            </p>
          </div>
          {voucher.invoiceNumber ? (
            <Link
              href={`/invoice/${encodeURIComponent(voucher.code)}`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas print:hidden"
            >
              {L("Lihat invoice", "View invoice")} · {voucher.invoiceNumber}
            </Link>
          ) : null}
        </div>

        {/* Operator note */}
        <div className="rounded-xl bg-canvas px-4 py-3 text-[12px] leading-relaxed text-muted print:bg-white print:px-0">
          <p>
            {L(
              "Tunjukkan e-voucher ini (cetak atau di layar) saat penjemputan. Jadwal dapat berubah menyesuaikan kondisi di lapangan — driver akan menghubungi kamu sebelum penjemputan.",
              "Show this e-voucher (printed or on screen) at pickup. The schedule may adjust to local conditions — your driver will contact you before pickup.",
            )}
          </p>
          <p className="mt-1">
            {L(
              "Butuh bantuan? Hubungi customer service Booking VIP melalui halaman kontak di situs kami.",
              "Need help? Reach Booking VIP customer service via the contact page on our site.",
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
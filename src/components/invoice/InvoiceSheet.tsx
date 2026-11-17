import type { InvoiceDTO } from "@/lib/invoice";

/** Friendly booking status labels; anything else falls back to title case. */
const BOOKING_STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Menunggu pembayaran",
  pending: "Menunggu pembayaran",
  confirmed: "Dikonfirmasi",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

/**
 * The printable invoice sheet.
 *
 * Pure presentation: no hooks and no server-only runtime imports (the DTO
 * type is erased at build time), so both server and client components can
 * render it. The sheet is deliberately plain — a white surface with thin
 * borders — so "Print → Save as PDF" produces a clean document.
 */
export default function InvoiceSheet({ invoice }: { invoice: InvoiceDTO }) {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const statusLabel =
    BOOKING_STATUS_LABELS[invoice.status] ??
    invoice.status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  const payment = invoice.payment;

  // Transport details — only the parts that exist are shown.
  const rentalDays =
    invoice.items.find((item) => item.unitKind === "per_day")?.quantity ?? null;
  const transportDetails = [
    rentalDays ? `Durasi sewa: ${rentalDays} hari` : null,
    invoice.driverOption === "with_driver"
      ? "Dengan supir"
      : invoice.driverOption === "without_driver"
        ? "Tanpa supir"
        : null,
    invoice.pickupPolicy === "vendor_pickup"
      ? "Ambil di lokasi vendor"
      : invoice.pickupPolicy === "delivered"
        ? "Diantar ke lokasi kamu"
        : null,
  ].filter((part): part is string => part !== null);

  return (
    <article className="rounded-2xl border border-line bg-white p-8 print:rounded-none print:border-0 print:p-0">
      {/* Head */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-[15px] font-extrabold tracking-[-0.01em] text-ink">
            Booking VIP
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            Airport Transfer &amp; Travel Services
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Invoice
          </p>
          <p className="mt-1 font-mono text-[13px] font-semibold text-ink">
            {invoice.invoiceNumber ?? invoice.code}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">Kode: {invoice.code}</p>
        </div>
      </header>

      {/* Meta */}
      <section className="grid gap-5 border-b border-line py-5 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            Tanggal layanan
          </p>
          <p className="mt-1 text-[13px] font-medium text-ink">
            {new Date(invoice.serviceAt).toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            Dibuat
          </p>
          <p className="mt-1 text-[13px] font-medium text-ink">
            {new Date(invoice.createdAt).toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            Status
          </p>
          <p className="mt-1 text-[13px] font-medium text-ink">
            {statusLabel}
          </p>
        </div>
      </section>

      {/* Contact */}
      {invoice.contact ? (
        <section className="grid gap-5 border-b border-line py-5 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
              Pemesan
            </p>
            <p className="mt-1 text-[13px] font-medium text-ink">
              {invoice.contact.firstName} {invoice.contact.lastName}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">{invoice.contact.email}</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {invoice.contact.phoneCountryCode} {invoice.contact.phone}
            </p>
          </div>
          {invoice.travelers.length > 0 ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                Penumpang ({invoice.travelers.length})
              </p>
              <ul className="mt-1 space-y-0.5">
                {invoice.travelers.map((traveler, index) => (
                  <li key={`${traveler.fullName}-${index}`} className="text-[12px] text-ink">
                    {traveler.fullName}
                    <span className="ml-1 text-muted">({traveler.kind})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Transport route */}
      {invoice.pickupLabel || invoice.dropoffLabel ? (
        <section className="border-b border-line py-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            Rute perjalanan
          </p>
          <div className="mt-2 space-y-1.5">
            {invoice.pickupLabel ? (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                  A
                </span>
                <p className="min-w-0 break-words text-[13px] text-ink">
                  {invoice.pickupLabel}
                </p>
              </div>
            ) : null}
            {invoice.dropoffLabel ? (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
                  B
                </span>
                <p className="min-w-0 break-words text-[13px] text-ink">
                  {invoice.dropoffLabel}
                </p>
              </div>
            ) : null}
          </div>
          {transportDetails.length > 0 ? (
            <p className="mt-2 text-[12px] text-muted">
              {transportDetails.join(" · ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Items */}
      <section className="py-5">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                Item
              </th>
              <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                Harga
              </th>
              <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                Jumlah
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoice.items.map((item, index) => (
              <tr key={`${item.label}-${index}`}>
                <td className="py-2.5 pr-3 text-[13px] text-ink">
                  {item.label}
                  {item.packageLabel ? (
                    <span className="block text-[11px] text-muted">{item.packageLabel}</span>
                  ) : null}
                  <span className="block text-[11px] text-muted">
                    {item.adultCount} dewasa · {item.childCount} anak · {item.infantCount} bayi
                  </span>
                </td>
                <td className="py-2.5 text-right text-[13px] text-muted">
                  {money(item.unitUsdCents)}
                  {item.unitKind === "per_day" ? "/hari" : ""}
                </td>
                <td className="py-2.5 text-right text-[13px] font-medium text-ink">
                  {item.unitKind === "per_day" ? (
                    <span className="block text-[11px] font-normal text-muted">
                      {item.quantity} hari
                    </span>
                  ) : null}
                  {money(item.totalUsdCents)}
                </td>
              </tr>
            ))}

            {invoice.addOns.map((addOn, index) => (
              <tr key={`${addOn.label}-add-${index}`}>
                <td className="py-2.5 pr-3 text-[13px] text-ink">
                  {addOn.label}
                  <span className="block text-[11px] text-muted">
                    Tambahan ×{addOn.quantity}
                  </span>
                </td>
                <td className="py-2.5 text-right text-[13px] text-muted">
                  {money(addOn.unitUsdCents)}
                </td>
                <td className="py-2.5 text-right text-[13px] font-medium text-ink">
                  {money(addOn.totalUsdCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Totals */}
      <section className="border-t border-line pt-4">
        <dl className="ml-auto w-full max-w-xs space-y-1.5 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-ink">{money(invoice.subtotalUsdCents)}</dd>
          </div>

          {invoice.addOnsUsdCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">Tambahan</dt>
              <dd className="text-ink">{money(invoice.addOnsUsdCents)}</dd>
            </div>
          ) : null}

          {invoice.discountUsdCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">
                Diskon{invoice.promoCode ? ` (${invoice.promoCode})` : ""}
              </dt>
              <dd className="text-success">-{money(invoice.discountUsdCents)}</dd>
            </div>
          ) : null}

          {invoice.taxes.map((tax) => (
            <div key={tax.key} className="flex justify-between">
              <dt className="text-muted">
                {tax.label} ({tax.value})
              </dt>
              <dd className="text-ink">{money(tax.amountUsdCents)}</dd>
            </div>
          ))}

          <div className="flex justify-between border-t border-line pt-2 text-[15px] font-bold">
            <dt className="text-ink">Total</dt>
            <dd className="text-ink">{money(invoice.totalUsdCents)}</dd>
          </div>
        </dl>
      </section>

      {/* Payment */}
      <section className="mt-5 border-t border-line pt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
          Pembayaran
        </p>
        {payment?.status === "paid" ? (
          <div className="mt-2 space-y-1.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-brand-dark">
                LUNAS
              </span>
              {payment.paidAt ? (
                <span className="text-ink">
                  Dibayar{" "}
                  {new Date(payment.paidAt).toLocaleDateString("id-ID", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              ) : null}
              <span className="text-muted">{payment.methodLabel ?? "Xendit"}</span>
            </div>
            {payment.providerRef ? (
              <p className="font-mono text-[12px] text-muted">
                Ref Xendit: {payment.providerRef}
              </p>
            ) : null}
            {payment.amountUsdCents != null ? (
              <p className="text-ink">
                Ditagih: {money(payment.amountUsdCents)}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 space-y-1.5">
            <span className="inline-block rounded-full border border-line bg-canvas px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted">
              Belum dibayar
            </span>
            <p className="text-[12px] text-muted">
              Invoice ini menjadi bukti pembayaran setelah transaksi selesai.
            </p>
          </div>
        )}
      </section>

      <footer className="mt-6 border-t border-line pt-4 text-[11px] text-muted">
        Invoice ini dibuat otomatis oleh sistem Booking VIP. Simpan sebagai PDF lewat
        tombol cetak di halaman.
      </footer>
    </article>
  );
}
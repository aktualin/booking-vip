"use client";

// The printable invoice — an order receipt in the marketplace style:
// the brand mark centred on top, a grey buyer/seller panel, the order meta
// row, the itemised table with variations, and the right-aligned total box.
//
// Pure presentation over the InvoiceDTO; it reads the active language from
// the LocaleProvider so the sheet prints in the visitor's language, and the
// brand from the admin branding setting (fallback: the built-in wordmark).

import { useLocale } from "@/components/providers/LocaleProvider";
import type { DictKey } from "@/i18n";
import type { InvoiceDTO } from "@/lib/invoice";
import type { BrandInfo } from "@/lib/branding";
import BrandWordmark from "@/components/layout/BrandWordmark";

/** Friendly booking status labels; anything else falls back to title case. */
const BOOKING_STATUS_KEYS: Record<string, DictKey> = {
  awaiting_payment: "invoice.status.awaiting",
  pending: "invoice.status.awaiting",
  confirmed: "invoice.status.confirmed",
  completed: "invoice.status.completed",
  cancelled: "invoice.status.cancelled",
};

export default function InvoiceSheet({
  invoice,
  brand = null,
}: {
  invoice: InvoiceDTO;
  brand?: BrandInfo | null;
}) {
  const { lang, t, formatMoney } = useLocale();
  const dateLocale = lang === "id" ? "id-ID" : "en-US";

  const statusKey = BOOKING_STATUS_KEYS[invoice.status];
  const statusLabel =
    statusKey != null
      ? t(statusKey)
      : invoice.status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  const paid = invoice.status === "confirmed" || invoice.status === "completed";
  const payment = invoice.payment;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

  /** The variation column per item kind. */
  const variationOf = (item: InvoiceDTO["items"][number]): string => {
    const parts: string[] = [];
    if (item.packageLabel) parts.push(item.packageLabel);
    if (item.unitKind === "per_day") {
      parts.push(t("invoice.rentalDays", { n: item.quantity }));
      if (invoice.driverOption === "with_driver") parts.push(t("invoice.withDriver"));
      if (invoice.driverOption === "without_driver") parts.push(t("invoice.withoutDriver"));
      if (invoice.pickupPolicy === "vendor_pickup") parts.push(t("invoice.vendorPickup"));
      if (invoice.pickupPolicy === "delivered") parts.push(t("invoice.delivered"));
    }
    if (item.unitKind === "per_pax") {
      parts.push(
        t("invoice.paxLine", {
          adults: item.adultCount,
          children: item.childCount,
          infants: item.infantCount,
        }),
      );
    }
    return parts.join(" · ");
  };

  const totalQty =
    invoice.items.reduce((sum, item) => sum + item.quantity, 0) +
    invoice.addOns.reduce((sum, addOn) => sum + addOn.quantity, 0);

  const buyerName = invoice.contact
    ? `${invoice.contact.firstName} ${invoice.contact.lastName}`.trim()
    : "—";

  return (
    <article className="rounded-2xl border border-line bg-white p-6 print:rounded-none print:border-0 print:p-0 md:p-10">
      {/* Head — brand mark centred, receipt title under it */}
      <header className="flex flex-col items-center border-b border-line pb-6 text-center">
        <BrandWordmark brand={brand ?? { appName: null, tagline: null }} dark />
        <p className="mt-1 text-[12px] text-muted">
          {brand?.tagline ?? "Airport Transfer & Travel Services"}
        </p>
        <h1 className="mt-4 text-[15px] font-bold tracking-[-0.01em] text-ink">
          {t("invoice.receipt")}
        </h1>
        <p className="mt-1 font-mono text-[13px] font-semibold text-ink">
          {invoice.invoiceNumber ?? invoice.code}
        </p>
      </header>

      {/* Buyer / seller panel */}
      <section className="mt-6 grid gap-6 rounded-xl bg-canvas p-5 sm:grid-cols-2">
        <div>
          <p className="text-[12px] text-muted">
            <span className="font-bold text-ink">{t("invoice.buyer")}:</span>{" "}
            <span className="font-medium text-ink">{buyerName}</span>
          </p>
          {invoice.contact ? (
            <>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                {invoice.contact.email}
                {invoice.contact.phone ? (
                  <>
                    <br />
                    {invoice.contact.phoneCountryCode} {invoice.contact.phone}
                  </>
                ) : null}
              </p>
            </>
          ) : null}
        </div>
        <div className="sm:text-right">
          <p className="text-[12px] text-muted">
            <span className="font-bold text-ink">{t("invoice.seller")}:</span>{" "}
            <span className="font-medium text-ink">
              {brand?.appName ?? "OurVacation"}
            </span>
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            {brand?.tagline ?? "Airport Transfer & Travel Services"}
          </p>
        </div>
      </section>

      {/* Meta row */}
      <section className="mt-6 grid gap-4 border-b border-line pb-5 sm:grid-cols-4">
        <div>
          <p className="text-[11px] font-semibold text-ink">{t("invoice.orderNo")}</p>
          <p className="mt-1 font-mono text-[12.5px] text-muted">{invoice.code}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-ink">{t("invoice.paidAt")}</p>
          <p className="mt-1 text-[12.5px] text-muted">
            {payment?.paidAt ? formatDate(payment.paidAt) : t("invoice.unpaid")}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-ink">{t("invoice.method")}</p>
          <p className="mt-1 text-[12.5px] text-muted">{payment?.methodLabel ?? "—"}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-ink">{t("invoice.service")}</p>
          <p className="mt-1 text-[12.5px] text-muted">
            {formatDate(invoice.serviceAt)}
            {invoice.driverOption === "with_driver" ? ` · ${t("invoice.withDriver")}` : ""}
          </p>
        </div>
      </section>

      {/* Items */}
      <section className="mt-6">
        <h2 className="text-[13px] font-bold text-ink">{t("invoice.items")}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[11px] text-muted">
                <th className="py-2 pr-3 font-medium">{t("invoice.colNo")}</th>
                <th className="py-2 pr-3 font-medium">{t("invoice.colItem")}</th>
                <th className="py-2 pr-3 font-medium">{t("invoice.colVariation")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("invoice.colPrice")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("invoice.colQty")}</th>
                <th className="py-2 text-right font-medium">{t("invoice.colSubtotal")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, index) => (
                <tr key={`item-${index}`} className="border-b border-line/70 align-top">
                  <td className="py-2.5 pr-3 text-[12px] text-muted">{index + 1}</td>
                  <td className="py-2.5 pr-3 text-[12.5px] font-medium text-ink">
                    {item.label}
                  </td>
                  <td className="py-2.5 pr-3 text-[12px] leading-relaxed text-muted">
                    {variationOf(item) || "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-[12px] text-muted">
                    {formatMoney(item.unitUsdCents / 100)}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-[12px] text-muted">
                    {item.quantity}
                  </td>
                  <td className="py-2.5 text-right text-[12px] font-medium text-ink">
                    {formatMoney(item.totalUsdCents / 100)}
                  </td>
                </tr>
              ))}
              {invoice.addOns.map((addOn, index) => (
                <tr key={`addon-${index}`} className="border-b border-line/70 align-top">
                  <td className="py-2.5 pr-3 text-[12px] text-muted">
                    {invoice.items.length + index + 1}
                  </td>
                  <td className="py-2.5 pr-3 text-[12.5px] font-medium text-ink">
                    {addOn.label}
                  </td>
                  <td className="py-2.5 pr-3 text-[12px] text-muted">
                    {t("invoice.addOnLine", { n: addOn.quantity })}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-[12px] text-muted">
                    {formatMoney(addOn.unitUsdCents / 100)}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-[12px] text-muted">
                    {addOn.quantity}
                  </td>
                  <td className="py-2.5 text-right text-[12px] font-medium text-ink">
                    {formatMoney(addOn.totalUsdCents / 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end">
          <dl className="text-right text-[12.5px]">
            <div className="flex justify-end gap-6">
              <dt className="font-bold text-ink">{t("invoice.subtotal")}</dt>
              <dd className="font-bold text-ink">
                {formatMoney(invoice.subtotalUsdCents / 100)}
              </dd>
            </div>
            <div className="mt-1 flex justify-end gap-6">
              <dt className="font-bold text-ink">{t("invoice.totalQty")}</dt>
              <dd className="font-bold text-ink">
                {t("invoice.itemsCount", { n: totalQty })}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Totals box */}
      <section className="mt-6 flex justify-end">
        <div className="w-full max-w-[320px] space-y-2 rounded-xl bg-canvas p-5 text-[12.5px]">
          <div className="flex justify-between">
            <span className="text-muted">{t("invoice.subtotal")}</span>
            <span className="text-ink">{formatMoney(invoice.subtotalUsdCents / 100)}</span>
          </div>
          {invoice.addOnsUsdCents > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted">{t("invoice.addOns")}</span>
              <span className="text-ink">{formatMoney(invoice.addOnsUsdCents / 100)}</span>
            </div>
          ) : null}
          {invoice.discountUsdCents > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted">{t("invoice.discount")}</span>
              <span className="text-success">−{formatMoney(invoice.discountUsdCents / 100)}</span>
            </div>
          ) : null}
          {invoice.taxes.map((line) => (
            <div key={line.key} className="flex justify-between">
              <span className="text-muted">
                {t("invoice.tax")} · {line.label}
              </span>
              <span className="text-ink">{formatMoney(line.amountUsdCents / 100)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 text-[14px]">
            <span className="font-extrabold text-ink">{t("invoice.total")}</span>
            <span className="font-extrabold text-ink">
              {formatMoney(invoice.totalUsdCents / 100)}
            </span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-8 border-t border-line pt-4 text-center">
        <p className="text-[12px] text-muted">
          <span className="font-semibold text-ink">{t("invoice.status")}:</span>{" "}
          {paid ? statusLabel : t("invoice.unpaid")}
          {" · "}
          {invoice.invoiceNumber ?? invoice.code}
        </p>
        <p className="mt-1 text-[11px] text-muted">
          {t("invoice.pageOf", { page: 1, pages: 1 })} · {t("invoice.endReceipt")}
        </p>
      </footer>
    </article>
  );
}

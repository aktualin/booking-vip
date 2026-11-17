"use client";

// The thank-you page body — Shopify-style: confirmation and customer
// information on the left, the itemised order total and the brand mark on
// the right. Reached from the waiting page (and directly after a saved-card
// charge that confirmed synchronously).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getPaymentPageDataAction } from "@/app/actions/payments";
import type { PaymentPageData } from "@/lib/payments";
import type { BrandInfo } from "@/lib/branding";
import { useAccountOverview } from "@/components/providers/AccountProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { PaymentBrandIcon } from "@/components/icons";
import BrandWordmark from "@/components/layout/BrandWordmark";

const LAST_BOOKING_KEY = "booking-vip:last-booking";

export default function PaymentSuccess({
  code,
  brand,
}: {
  code: string;
  brand: BrandInfo;
}) {
  const { t, formatMoney, lang } = useLocale();
  const { overview } = useAccountOverview();

  const [email, setEmail] = useState("");
  const [data, setData] = useState<PaymentPageData | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ownership email: the browser's last booking, then the signed-in account.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_BOOKING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { code?: string; email?: string };
        if (parsed.code === code && parsed.email) {
          setEmail(parsed.email);
          return;
        }
      }
    } catch {
      // Storage unavailable — the account email below takes over.
    }
  }, [code]);

  useEffect(() => {
    if (!email && overview?.email) setEmail(overview.email);
  }, [email, overview]);

  const load = useCallback(
    async (address: string) => {
      const result = await getPaymentPageDataAction({ bookingCode: code, email: address });
      if (!result.ok) {
        setError(result.error);
        setSettled(true);
        return;
      }
      setError(null);
      setData(result.data);
      if (result.data.payment.status === "paid" || result.data.invoice.status === "confirmed") {
        setSettled(true);
      }
    },
    [code],
  );

  useEffect(() => {
    if (!email) return;
    void load(email);
    // A direct open right after the charge can race the webhook — poll a
    // few times before giving up on the confirmation.
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks >= 6) {
        clearInterval(timer);
        setSettled(true);
        return;
      }
      void load(email);
    }, 3000);
    return () => clearInterval(timer);
  }, [email, load]);

  /* ------------------------------------------------------------------ */
  if (!email) {
    return (
      <div className="mx-auto w-full max-w-[460px] rounded-2xl border border-line bg-white p-8 text-center">
        <h1 className="text-[18px] font-bold text-ink">{t("success.order", { code })}</h1>
        <p className="mt-2 text-[13px] text-muted">{t("payment.emailGate")}</p>
        <EmailGate onEmail={setEmail} />
      </div>
    );
  }

  if (error || (settled && (!data || data.payment.status !== "paid"))) {
    // Not (yet) paid — the waiting page owns this state.
    return (
      <div className="mx-auto w-full max-w-[460px] rounded-2xl border border-line bg-white p-8 text-center">
        <h1 className="text-[18px] font-bold text-ink">{t("waiting.title")}</h1>
        <p className="mt-2 text-[13px] text-muted">
          {error ?? t("waiting.desc")}
        </p>
        <Link
          href={`/payment/return?code=${encodeURIComponent(code)}`}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-brand px-6 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          {t("waiting.title")}
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-[460px] rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted">
        Memuat pesanan…
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  const invoice = data.invoice;
  const contact = invoice.contact;
  const contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : "";
  const dateLocale = lang === "id" ? "id-ID" : "en-US";
  const savedCard = data.payment.savedCard;

  const serviceDetails = [
    new Date(invoice.serviceAt).toLocaleDateString(dateLocale, {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    invoice.pickupLabel ? `↑ ${invoice.pickupLabel}` : null,
    invoice.dropoffLabel ? `↓ ${invoice.dropoffLabel}` : null,
    invoice.driverOption === "with_driver"
      ? t("invoice.withDriver")
      : invoice.driverOption === "without_driver"
        ? t("invoice.withoutDriver")
        : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
      {/* Left — confirmation + customer information */}
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-brand text-brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <div>
            <p className="text-[13px] text-muted">{t("success.order", { code })}</p>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink">
              {t("success.thanks", { name: contactName || "!" })}
            </h1>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-line bg-white p-4">
          <p className="text-[13.5px] font-semibold text-ink">{t("success.confirmed")}</p>
          <p className="mt-1 text-[12.5px] text-muted">{t("success.confirmedDesc")}</p>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-white p-5">
          <h2 className="text-[14px] font-bold text-ink">{t("success.customerInfo")}</h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                {t("success.contact")}
              </p>
              <p className="mt-1 text-[13px] text-ink">{contact?.email ?? "—"}</p>
              {contact?.phone ? (
                <p className="mt-0.5 text-[13px] text-ink">
                  {contact.phoneCountryCode} {contact.phone}
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                {t("success.paymentMethod")}
              </p>
              <p className="mt-1 flex items-center gap-2 text-[13px] text-ink">
                {savedCard ? (
                  <>
                    {savedCard.brand === "visa" ||
                    savedCard.brand === "mastercard" ||
                    savedCard.brand === "amex" ||
                    savedCard.brand === "jcb" ||
                    savedCard.brand === "discover" ? (
                      <PaymentBrandIcon brand={savedCard.brand} height={14} />
                    ) : null}
                    {t("success.endingIn", { last4: savedCard.last4 })}
                  </>
                ) : (
                  (data.payment.methodLabel ?? "—")
                )}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                {t("success.billingAddress")}
              </p>
              <p className="mt-1 text-[13px] text-ink">{contactName || "—"}</p>
              <p className="mt-0.5 text-[13px] text-muted">{contact?.email ?? ""}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                {t("success.serviceDetails")}
              </p>
              {serviceDetails.map((line, index) => (
                <p key={index} className="mt-1 text-[13px] text-ink first:mt-1">
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={`/invoice/${encodeURIComponent(code)}`}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            {t("success.viewInvoice")}
          </Link>
          {data.visaCode ? (
            <Link
              href={`/account/visa/${encodeURIComponent(data.visaCode)}`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
            >
              {t("success.trackEvoa")}
            </Link>
          ) : null}
          <Link
            href="/account/orders"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
          >
            {t("success.viewOrders")}
          </Link>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
          >
            {t("success.backHome")}
          </Link>
        </div>
      </div>

      {/* Right — itemised total + brand mark */}
      <aside className="rounded-xl border border-line bg-white p-5">
        <ul className="space-y-3">
          {invoice.items.map((item, index) => (
            <li key={index} className="flex items-start justify-between gap-3">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-[11px] font-bold text-muted">
                {item.label.slice(0, 2).toUpperCase()}
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-bold text-white">
                  {item.quantity}
                </span>
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted">
                <span className="font-medium text-ink">{item.label}</span>
                {item.packageLabel ? ` · ${item.packageLabel}` : ""}
              </span>
              <span className="shrink-0 text-[12.5px] font-semibold text-ink">
                {formatMoney(item.totalUsdCents / 100)}
              </span>
            </li>
          ))}
          {invoice.addOns.map((addOn, index) => (
            <li key={`add-${index}`} className="flex items-start justify-between gap-3">
              <span className="min-w-0 flex-1 text-[12.5px] text-muted">
                {addOn.label} ×{addOn.quantity}
              </span>
              <span className="shrink-0 text-[12.5px] font-semibold text-ink">
                {formatMoney(addOn.totalUsdCents / 100)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-[12.5px]">
          <div className="flex justify-between">
            <dt className="text-muted">{t("invoice.subtotal")}</dt>
            <dd className="text-ink">{formatMoney(invoice.subtotalUsdCents / 100)}</dd>
          </div>
          {invoice.discountUsdCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">{t("invoice.discount")}</dt>
              <dd className="text-success">−{formatMoney(invoice.discountUsdCents / 100)}</dd>
            </div>
          ) : null}
          {invoice.taxes.map((line) => (
            <div key={line.key} className="flex justify-between">
              <dt className="text-muted">{line.label}</dt>
              <dd className="text-ink">{formatMoney(line.amountUsdCents / 100)}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-[13px] font-semibold text-muted">{t("payment.total")}</span>
          <span className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">
            <span className="mr-1 align-middle text-[11px] font-semibold text-muted">USD</span>
            {formatMoney(invoice.totalUsdCents / 100)}
          </span>
        </div>

        <div className="mt-6 flex justify-end">
          <BrandWordmark brand={brand} dark />
        </div>
      </aside>
    </div>
  );
}

/** The tiny email gate of the success page (guest without localStorage). */
function EmailGate({ onEmail }: { onEmail: (email: string) => void }) {
  const { t } = useLocale();
  const [value, setValue] = useState("");
  return (
    <form
      className="mt-4 flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        onEmail(value.trim().toLowerCase());
      }}
    >
      <input
        type="email"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("payment.emailPlaceholder")}
        className="h-11 flex-1 rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
      />
      <button
        type="submit"
        className="h-11 rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        {t("payment.continue")}
      </button>
    </form>
  );
}

"use client";

// The checkout page of an existing unpaid booking: the payment form on the
// left (saved cards CVV-only + gateway methods + PayPal express), the order
// summary on the right. A failed or expired gateway return lands here with
// ?status=… and renders the checkout banner above the form.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getPaymentPageDataAction, type PaymentPageDataResult } from "@/app/actions/payments";
import type { PaymentPageData } from "@/lib/payments";
import { useAccountOverview } from "@/components/providers/AccountProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { showToast } from "@/components/ui/toast";
import PaymentForm, { type PayIntent } from "./PaymentForm";
import { dispatchPayIntent } from "./dispatch";

const LAST_BOOKING_KEY = "booking-vip:last-booking";

export default function PaymentPageClient({
  code,
  initialStatus,
}: {
  code: string;
  initialStatus: "failed" | "expired" | null;
}) {
  const router = useRouter();
  const { t, formatMoney } = useLocale();
  const { overview } = useAccountOverview();

  const [email, setEmail] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [data, setData] = useState<PaymentPageData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<"failed" | "expired" | null>(initialStatus);
  const [submitting, setSubmitting] = useState(false);

  // Resolve the ownership email: the browser's last booking first, then the
  // signed-in account. Guests without either type it once.
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
      // Storage unavailable — fall through to the account / typed email.
    }
  }, [code]);

  useEffect(() => {
    if (email) return;
    if (overview?.email) setEmail(overview.email);
  }, [overview, email]);

  const load = useCallback(
    async (address: string) => {
      const result: PaymentPageDataResult = await getPaymentPageDataAction({
        bookingCode: code,
        email: address,
      });
      if (!result.ok) {
        setLoadError(result.error);
        setLoaded(true);
        return;
      }
      setLoadError(null);
      setData(result.data);
      setLoaded(true);

      // Already settled — straight to the thank-you page.
      if (result.data.payment.status === "paid") {
        router.replace(`/payment/success/${encodeURIComponent(code)}`);
      }
    },
    [code, router],
  );

  useEffect(() => {
    if (!email) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    void load(email);
  }, [email, load]);

  const pay = async (intent: PayIntent) => {
    if (submitting || !email) return;
    setSubmitting(true);
    const result = await dispatchPayIntent(intent, { bookingCode: code, email });
    if (!result.ok) {
      setBanner("failed");
      showToast(result.error, "error");
      setSubmitting(false);
      return;
    }
    window.location.assign(result.redirectUrl);
  };

  /* ------------------------------------------------------------------ */
  /* Email gate                                                          */
  /* ------------------------------------------------------------------ */
  if (!email) {
    return (
      <div className="mx-auto w-full max-w-[460px] rounded-2xl border border-line bg-white p-6 md:p-8">
        <h1 className="text-[18px] font-bold tracking-[-0.01em] text-ink">
          {t("payment.title")} · <span className="font-mono">{code}</span>
        </h1>
        <p className="mt-2 text-[13px] text-muted">{t("payment.emailGate")}</p>
        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            setEmail(emailInput.trim().toLowerCase());
          }}
        >
          <input
            type="email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
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
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Loading / error                                                     */
  /* ------------------------------------------------------------------ */
  if (!loaded || (!data && !loadError)) {
    return (
      <div className="mx-auto w-full max-w-[460px] rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted">
        Memuat pesanan…
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="mx-auto w-full max-w-[460px] rounded-2xl border border-line bg-white p-8 text-center">
        <h1 className="text-[18px] font-bold text-ink">{loadError}</h1>
        <Link
          href="/account/orders"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
        >
          {t("success.viewOrders")}
        </Link>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Checkout                                                            */
  /* ------------------------------------------------------------------ */
  const invoice = data.invoice;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
      <PaymentForm
        onPay={pay}
        isSubmitting={submitting}
        banner={banner}
        onBack={() => router.back()}
      />

      <aside className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-[14px] font-bold text-ink">{t("payment.orderSummary")}</h2>
        <p className="mt-1 font-mono text-[13px] font-semibold text-ink">{invoice.code}</p>
        {invoice.invoiceNumber ? (
          <p className="mt-0.5 font-mono text-[11px] text-muted">{invoice.invoiceNumber}</p>
        ) : null}

        <ul className="mt-4 space-y-2 border-t border-line pt-4">
          {invoice.items.map((item, index) => (
            <li key={index} className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-[12.5px] leading-snug text-muted">
                <span className="font-medium text-ink">{item.label}</span>
                {item.packageLabel ? ` · ${item.packageLabel}` : ""}
                {item.quantity > 1 ? ` ×${item.quantity}` : ""}
              </span>
              <span className="shrink-0 text-[12.5px] font-semibold text-ink">
                {formatMoney(item.totalUsdCents / 100)}
              </span>
            </li>
          ))}
          {invoice.addOns.map((addOn, index) => (
            <li key={`add-${index}`} className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-[12.5px] text-muted">
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
            <dd className="font-medium text-ink">
              {formatMoney(invoice.subtotalUsdCents / 100)}
            </dd>
          </div>
          {invoice.discountUsdCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">{t("invoice.discount")}</dt>
              <dd className="font-medium text-success">
                −{formatMoney(invoice.discountUsdCents / 100)}
              </dd>
            </div>
          ) : null}
          {invoice.taxes.map((line) => (
            <div key={line.key} className="flex justify-between">
              <dt className="text-muted">{line.label}</dt>
              <dd className="font-medium text-ink">
                {formatMoney(line.amountUsdCents / 100)}
              </dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 text-[14px]">
            <dt className="font-bold text-ink">{t("payment.total")}</dt>
            <dd className="font-bold text-ink">
              {formatMoney(invoice.totalUsdCents / 100)}
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

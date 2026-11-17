"use client";

// The waiting-for-payment page — where the customer lands after the gateway
// redirect (and where a saved-card 3DS round trip comes back to).
//
// It polls the payment status; a paid attempt hands over to the thank-you
// page, a failed or expired one sends the customer back to the payment form
// with the checkout banner. While open, it shows the order summary, the
// countdown of the payment window and the gateway page button.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getPaymentPageDataAction } from "@/app/actions/payments";
import type { PaymentPageData } from "@/lib/payments";
import { useLocale } from "@/components/providers/LocaleProvider";

const LAST_BOOKING_KEY = "booking-vip:last-booking";

export default function PaymentReturn({
  bookingCode,
  initialFailed,
}: {
  bookingCode: string;
  initialFailed?: boolean;
}) {
  const router = useRouter();
  const { t, formatMoney } = useLocale();

  const [email, setEmail] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [data, setData] = useState<PaymentPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A failed gateway return never waits — straight back to the payment form
  // with the banner, exactly like a declined card on the checkout.
  useEffect(() => {
    if (initialFailed) {
      router.replace(`/pay/${encodeURIComponent(bookingCode)}?status=failed`);
    }
  }, [initialFailed, bookingCode, router]);

  // Tick the countdown.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const poll = useCallback(
    async (address: string) => {
      const result = await getPaymentPageDataAction({
        bookingCode,
        email: address,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setData(result.data);

      const status = result.data.payment.status;
      if (status === "paid" || result.data.invoice.status === "confirmed") {
        router.replace(`/payment/success/${encodeURIComponent(bookingCode)}`);
        return;
      }
      if (status === "failed") {
        router.replace(`/pay/${encodeURIComponent(bookingCode)}?status=failed`);
        return;
      }
      const expiresAt = result.data.payment.expiresAt;
      const expired =
        status === "pending" && expiresAt
          ? new Date(expiresAt).getTime() <= Date.now()
          : false;
      if (expired) {
        router.replace(`/pay/${encodeURIComponent(bookingCode)}?status=expired`);
      }
    },
    [bookingCode, router],
  );

  // Pick up the email of the last booking, then start polling.
  useEffect(() => {
    if (initialFailed) return;
    try {
      const raw = localStorage.getItem(LAST_BOOKING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { code?: string; email?: string };
        if (parsed.email && parsed.code === bookingCode) {
          setEmail(parsed.email);
          return;
        }
      }
    } catch {
      // Storage unavailable — the email is asked for below.
    }
  }, [bookingCode, initialFailed]);

  useEffect(() => {
    if (!email || initialFailed) return;
    void poll(email);
    const timer = setInterval(() => void poll(email), 5000);
    return () => clearInterval(timer);
  }, [email, poll, initialFailed]);

  const countdown = useMemo(() => {
    const expiresAt = data?.payment.expiresAt;
    if (!expiresAt) return null;
    const left = new Date(expiresAt).getTime() - now;
    if (left <= 0) return "00:00";
    const minutes = Math.floor(left / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [data, now]);

  if (initialFailed) return null;

  /* ------------------------------------------------------------------ */
  /* Email gate                                                          */
  /* ------------------------------------------------------------------ */
  if (!email) {
    return (
      <div className="mx-auto w-full max-w-[460px] rounded-2xl border border-line bg-white p-6 md:p-8">
        <h1 className="text-[18px] font-bold tracking-[-0.01em] text-ink">
          {t("waiting.title")}
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
  /* Waiting                                                             */
  /* ------------------------------------------------------------------ */
  const invoice = data?.invoice ?? null;

  return (
    <div className="mx-auto w-full max-w-[560px] rounded-2xl border border-line bg-white p-6 md:p-8">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
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

        <h1 className="mt-4 text-[20px] font-bold tracking-[-0.01em] text-ink">
          {t("waiting.title")}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {t("waiting.desc")}
        </p>

        {countdown ? (
          <p className="mt-4 font-mono text-[26px] font-bold tabular-nums text-ink">
            <span className="mr-2 align-middle text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              {t("waiting.countdown")}
            </span>
            {countdown}
          </p>
        ) : null}
      </div>

      {/* Order summary */}
      <dl className="mt-6 space-y-2 rounded-xl border border-line bg-canvas/60 p-4 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t("waiting.order")}</dt>
          <dd className="font-mono font-semibold text-ink">{bookingCode}</dd>
        </div>
        {invoice ? (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t("waiting.amount")}</dt>
              <dd className="font-semibold text-ink">
                {formatMoney(invoice.totalUsdCents / 100)}
              </dd>
            </div>
            {data?.payment.methodLabel ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t("waiting.method")}</dt>
                <dd className="font-medium text-ink">{data.payment.methodLabel}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>

      {error ? (
        <p className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        {data?.payment.checkoutUrl ? (
          <Link
            href={data.payment.checkoutUrl}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            {t("waiting.openGateway")}
          </Link>
        ) : null}
        <Link
          href={`/pay/${encodeURIComponent(bookingCode)}`}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
        >
          {t("waiting.changeMethod")}
        </Link>
      </div>

      <p className="mt-4 text-center text-[12px] text-muted">
        {t("waiting.dontClose")}
      </p>
    </div>
  );
}

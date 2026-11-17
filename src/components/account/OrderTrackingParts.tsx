"use client";

import Link from "next/link";
import { useLocale } from "@/components/providers/LocaleProvider";

/**
 * The translated pieces of the order-tracking and invoice pages.
 *
 * Those pages are server components (session + data reads), so every bit of
 * visible copy lives in these small client components and reads the active
 * language from the LocaleProvider.
 */

/** "← Back to orders" link under the page head. */
export function BackToOrdersLink() {
  const { t } = useLocale();
  return (
    <Link
      href="/account/orders"
      className="text-[12px] font-medium text-muted transition-colors hover:text-ink"
    >
      {t("orderTrack.back")}
    </Link>
  );
}

/** The "Loading…" fallback of the page-level Suspense boundary. */
export function OrdersLoadingText() {
  const { t } = useLocale();
  return (
    <p className="px-5 py-10 text-center text-[13px] text-muted">
      {t("orders.loading")}
    </p>
  );
}

/** Shown when the session cookie is missing or invalid. */
export function SessionInvalidNotice({
  body,
  className = "",
}: {
  /** The explanation — differs between the tracking page and the invoice. */
  body: "track" | "invoice";
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div
      className={`rounded-2xl border border-line bg-white p-10 text-center ${className}`}
    >
      <h1 className="text-[18px] font-bold text-ink">
        {t("orderTrack.sessionInvalid")}
      </h1>
      <p className="mt-2 text-[13px] text-muted">
        {body === "invoice"
          ? t("invoice.sessionInvalidBody")
          : t("orderTrack.sessionInvalidBody")}
      </p>
      <Link
        href="/login"
        className="mt-5 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[13px] font-semibold text-white"
      >
        {t("orderTrack.signIn")}
      </Link>
    </div>
  );
}

/** Shown when the code is unknown or belongs to another account. */
export function NotFoundNotice({
  kind,
  className = "",
}: {
  kind: "order" | "invoice";
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div
      className={`rounded-2xl border border-line bg-white p-10 text-center ${className}`}
    >
      <h1 className="text-[18px] font-bold text-ink">
        {kind === "invoice" ? t("invoice.notFound") : t("orderTrack.notFound")}
      </h1>
      <p className="mt-2 text-[13px] text-muted">
        {t("orderTrack.notFoundBody")}
      </p>
      <Link
        href="/account/orders"
        className="mt-5 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[13px] font-semibold text-white"
      >
        {t("orderTrack.backToOrders")}
      </Link>
    </div>
  );
}

/** The compact booking summary above the VIP timeline. */
export function OrderSummaryCard({
  code,
  serviceAt,
  totalUsd,
}: {
  code: string;
  serviceAt: string;
  totalUsd: number;
}) {
  const { lang, t } = useLocale();
  const dateLocale = lang === "id" ? "id-ID" : "en-US";

  return (
    <div className="mb-6 rounded-2xl border border-line bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <p className="text-xs text-muted">{t("orderTrack.bookingCode")}</p>
          <p className="font-mono text-lg font-bold text-ink">{code}</p>
        </div>
        <Link
          href={`/account/orders/${encodeURIComponent(code)}/invoice`}
          className="text-[12px] font-semibold text-brand transition-opacity hover:opacity-80"
        >
          {t("orderTrack.downloadInvoice")}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 pt-4 text-sm">
        <div>
          <p className="text-muted">{t("orderTrack.serviceDate")}</p>
          <p className="font-semibold text-ink">
            {new Date(serviceAt).toLocaleDateString(dateLocale, {
              weekday: "short",
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        <div>
          <p className="text-muted">{t("orderTrack.total")}</p>
          <p className="font-semibold text-brand">${totalUsd.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}

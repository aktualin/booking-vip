"use client";

import Link from "next/link";
import AccountPageHeader from "@/components/account/AccountPageHeader";
import { useLocale } from "@/components/providers/LocaleProvider";

/**
 * The translated pieces of the customer e-VOA tracking page.
 *
 * The page itself is a server component (it reads the session and the
 * order), so the visible copy lives in these small client components.
 */

/** The page head with the translated title, subtitle and back label. */
export function VisaTrackingHeader() {
  const { t } = useLocale();
  return (
    <AccountPageHeader
      title={t("visaTrack.title")}
      description={t("visaTrack.subtitle")}
      backHref="/account/orders"
      backLabel={t("visaTrack.back")}
    />
  );
}

/** The "Loading…" fallback of the page-level Suspense boundary. */
export function VisaLoadingText() {
  const { t } = useLocale();
  return (
    <p className="px-5 py-10 text-center text-[13px] text-muted">
      {t("orders.loading")}
    </p>
  );
}

/** Shown when the application code is unknown or belongs to another account. */
export function VisaNotFoundNotice() {
  const { t } = useLocale();
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-white p-8 text-center">
      <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
        {t("visaTrack.notFound")}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        {t("visaTrack.notFoundBody")}
      </p>
      <Link
        href="/account/orders"
        className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand px-6 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
      >
        {t("visaTrack.back")}
      </Link>
    </div>
  );
}

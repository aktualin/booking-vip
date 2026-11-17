"use client";

import Link from "next/link";
import { ChevronLeft } from "@/components/icons";
import { useLocale } from "@/components/providers/LocaleProvider";

/**
 * The title block of an account sub-page.
 *
 * A back link to the account hub plus the title and an optional note — the
 * same minimal pattern as the rest of the site. The default back label is
 * translated; callers may still pass their own.
 */
export default function AccountPageHeader({
  title,
  description,
  backHref = "/account",
  backLabel,
  action,
}: {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="mb-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ChevronLeft width={14} height={14} />
        {backLabel ?? t("account.backToHub")}
      </Link>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.01em] text-ink md:text-[26px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
    </div>
  );
}

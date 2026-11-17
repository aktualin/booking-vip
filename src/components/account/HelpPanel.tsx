"use client";

import Link from "next/link";
import AccountPageHeader from "@/components/account/AccountPageHeader";
import ComingSoon from "@/components/ui/ComingSoon";
import { useLocale } from "@/components/providers/LocaleProvider";

/** The help centre content — still being written, fully translated. */
export default function HelpPanel() {
  const { t } = useLocale();
  return (
    <div>
      <AccountPageHeader
        title={t("help.title")}
        description={t("help.subtitle")}
      />

      <ComingSoon
        title={t("help.soonTitle")}
        description={t("help.soonBody")}
        action={
          <Link
            href="/account"
            className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-[13px] font-medium text-ink transition-colors hover:bg-canvas"
          >
            {t("help.backToHub")}
          </Link>
        }
      />
    </div>
  );
}

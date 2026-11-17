"use client";

import Link from "next/link";
import { serviceNav } from "@/data/services";
import { useLocale } from "@/components/providers/LocaleProvider";
import { SERVICE_LABEL_KEYS } from "@/lib/serviceLabels";
import type { DictKey } from "@/i18n";

/**
 * The footer link columns — the real service routes and the legal documents.
 *
 * A client component because the labels come from the locale dictionary;
 * the surrounding footer is a server component that reads the site-info
 * setting from the database.
 */
export default function FooterNav() {
  const { t } = useLocale();

  return (
    <>
      {/* The Services column lists exactly the navigable service lines. */}
      <div>
        <h3 className="mb-3 text-sm font-bold text-white">
          {t("footer.services")}
        </h3>
        <ul className="space-y-2 text-sm">
          {serviceNav.map((s) => {
            const key: DictKey | undefined = SERVICE_LABEL_KEYS[s.label];
            return (
              <li key={s.href}>
                <Link href={s.href} className="hover:text-white">
                  {key ? t(key) : s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* The Legal column links the admin-maintained documents. */}
      <div>
        <h3 className="mb-3 text-sm font-bold text-white">{t("footer.legal")}</h3>
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/terms" className="hover:text-white">
              {t("footer.terms")}
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="hover:text-white">
              {t("footer.privacyPolicy")}
            </Link>
          </li>
        </ul>
      </div>
    </>
  );
}

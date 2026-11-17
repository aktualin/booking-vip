"use client";

import Link from "next/link";
import AccountPageHeader from "@/components/account/AccountPageHeader";
import { useAccountOverview } from "@/components/providers/AccountProvider";
import { useLocale } from "@/components/providers/LocaleProvider";

/**
 * The settings page.
 *
 * The navigation on the left comes from the account shell, so this panel is
 * only the settings themselves. Every control here is wired to something
 * real — the profile forms live on `/account/profile`, and the
 * language switch is the site-wide one from `LocaleProvider`.
 */
export default function SettingsPanel() {
  const { overview } = useAccountOverview();
  const { lang, setLang, t } = useLocale();
  const numberLocale = lang === "id" ? "id-ID" : "en-US";

  return (
    <div>
      <AccountPageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
      />

      <div className="space-y-5">
        {/* Account & security */}
        <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {t("settings.accountTitle")}
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            {t("settings.accountDesc")}
          </p>

          <ul className="mt-4 divide-y divide-line border-y border-line">
            <SettingRow
              href="/account/profile"
              title={t("settings.row.profile")}
              description={t("settings.row.profile.desc")}
            />
            <SettingRow
              href="/account/profile"
              title={t("settings.row.password")}
              description={t("settings.row.password.desc")}
            />
            <SettingRow
              href="/account/loyalty"
              title={t("settings.row.loyalty")}
              description={
                overview?.level
                  ? t("settings.row.loyalty.desc", {
                      tier: overview.level.name,
                      points: overview.points.toLocaleString(numberLocale),
                    })
                  : t("settings.row.loyalty.descEmpty")
              }
            />
          </ul>
        </section>

        {/* Language */}
        <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {t("settings.langTitle")}
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            {t("settings.langDesc")}
          </p>

          <div className="mt-4">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("settings.langLabel")}
              </span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as "en" | "id")}
                className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
              >
                <option value="id">Bahasa Indonesia</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
      </section>
      </div>
    </div>
  );
}

function SettingRow({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  const { t } = useLocale();
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-4 py-3.5 transition-colors hover:bg-canvas"
      >
        <span>
          <span className="block text-[13px] font-medium text-ink">{title}</span>
          <span className="block text-[12px] text-muted">{description}</span>
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-brand">{t("settings.open")}</span>
      </Link>
    </li>
  );
}

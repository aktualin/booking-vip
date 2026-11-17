"use client";

import Link from "next/link";
import { useAccountOverview } from "@/components/providers/AccountProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import type { DictKey } from "@/i18n";

/**
 * The account sidebar.
 *
 * The identity card on top (name, tier, points — all from the database)
 * followed by the account routes. The caller passes the current pathname so
 * the sidebar does not have to read it itself.
 */
export default function AccountNav({ active }: { active: string }) {
  const { overview, loading } = useAccountOverview();
  const { lang, t } = useLocale();
  const numberLocale = lang === "id" ? "id-ID" : "en-US";

  // Below lg the hub at /account is the navigation, so the rail is hidden.
  return (
    <aside className="hidden space-y-4 lg:block">
      {/* Identity */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white p-4">
        {loading ? (
          <div className="animate-pulse">
            <div className="h-4 w-32 rounded bg-canvas" />
            <div className="mt-3 h-[66px] rounded-xl bg-canvas" />
          </div>
        ) : (
          <>
            <p className="text-[15px] font-bold tracking-[-0.01em] text-ink">
              {overview?.name ?? overview?.email ?? "—"}
            </p>

            <div className="mt-3 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 p-3 text-white">
              <p className="text-[12px] font-semibold">
                {overview?.level
                  ? t("account.nav.tier", { name: overview.level.name })
                  : t("account.nav.noTier")}
              </p>
              <p className="mt-1 text-[15px] font-bold">
                {t("account.nav.points", {
                  n: (overview?.points ?? 0).toLocaleString(numberLocale),
                })}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Routes */}
      <nav className="overflow-hidden rounded-2xl border border-line bg-white">
        {ITEMS.map((item) => {
          const isActive = isActiveRoute(item.href, active);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`block border-b border-line px-4 py-3 text-[13px] transition-colors last:border-b-0 ${
                isActive
                  ? "bg-brand-soft font-semibold text-brand"
                  : "text-ink hover:bg-canvas"
              }`}
            >
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * A route is active on its own page and on the pages below it, so an order
 * detail keeps "Pesanan Saya" highlighted. "/account" is the prefix of every
 * other route, so it only ever matches exactly.
 */
function isActiveRoute(href: string, pathname: string): boolean {
  if (href === pathname) return true;
  if (href === "/account") return false;
  return pathname.startsWith(`${href}/`);
}

const ITEMS: { href: string; labelKey: DictKey }[] = [
  { href: "/account", labelKey: "account.nav.hub" },
  { href: "/account/profile", labelKey: "account.nav.profile" },
  { href: "/account/orders", labelKey: "account.nav.orders" },
  { href: "/account/loyalty", labelKey: "account.nav.loyalty" },
  { href: "/account/payments", labelKey: "account.nav.payments" },
  { href: "/account/reviews", labelKey: "account.nav.reviews" },
  { href: "/account/help", labelKey: "account.nav.help" },
  { href: "/account/settings", labelKey: "account.nav.settings" },
];

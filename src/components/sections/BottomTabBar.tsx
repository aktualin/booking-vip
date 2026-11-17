"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import {
  BellIcon,
  GiftIcon,
  HomeIcon,
  ListIcon,
  PlaneIcon,
  UserIcon,
} from "@/components/icons";
import { useLocale } from "@/components/providers/LocaleProvider";
import type { DictKey } from "@/i18n";

const tabs = [
  { labelKey: "tabBar.home" as DictKey, Icon: HomeIcon, href: "/", active: true },
  { labelKey: "tabBar.rewards" as DictKey, Icon: GiftIcon, href: "#" },
  { labelKey: "tabBar.yourOrders" as DictKey, Icon: ListIcon, href: "/my-booking" },
  { labelKey: "tabBar.notification" as DictKey, Icon: BellIcon, href: "#" },
  { labelKey: "tabBar.account" as DictKey, Icon: UserIcon, href: "#" },
];

/** The single service tab — the Airport VIP booking tool, right after Home. */
const SERVICE_TAB = {
  labelKey: "tabBar.airportVip" as DictKey,
  Icon: PlaneIcon,
  href: "/airport-vip",
};

/**
 * The bottom tab bar. `usePathname()` is only available at runtime, so the
 * pathname-reading inner component sits behind a Suspense boundary — without
 * it, prerendering any page that mounts the tab bar fails (cacheComponents).
 */
export default function BottomTabBar() {
  return (
    <Suspense fallback={null}>
      <BottomTabBarInner />
    </Suspense>
  );
}

function BottomTabBarInner() {
  const pathname = usePathname();
  const serviceActive =
    pathname === SERVICE_TAB.href ||
    pathname.startsWith(`${SERVICE_TAB.href}/`);

  const items = [
    tabs[0],
    { ...SERVICE_TAB, active: serviceActive },
    ...tabs.slice(1),
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="flex">
        {items.map((tab) => (
          <TabItem key={tab.labelKey} {...tab} />
        ))}
      </ul>
    </nav>
  );
}

function TabItem({
  labelKey,
  Icon,
  href,
  active,
}: {
  labelKey: DictKey;
  Icon: (typeof tabs)[number]["Icon"];
  href: string;
  active?: boolean;
}) {
  const { t } = useLocale();
  const className = `flex w-full flex-col items-center gap-1 py-2 text-[10px] ${
    active ? "text-brand" : "text-muted"
  }`;

  return (
    <li className="flex-1">
      {href === "#" ? (
        <button className={className}>
          <Icon width={20} height={20} />
          {t(labelKey)}
        </button>
      ) : (
        <Link href={href} className={className}>
          <Icon width={20} height={20} />
          {t(labelKey)}
        </Link>
      )}
    </li>
  );
}
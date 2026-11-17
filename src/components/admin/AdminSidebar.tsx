"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  Building2,
  Calendar,
  Car,
  ChevronDown,
  ClipboardList,
  Compass,
  FileText,
  IdCard,
  LayoutDashboard,
  Layers,
  List,
  MapPin,
  Package,
  Percent,
  Plane,
  ReceiptText,
  Settings,
  Stamp,
  Tag,
  Ticket,
  Tickets,
  Users,
  Van,
  type LucideIcon,
} from "lucide-react";
import { TRANSACTION_LINES } from "@/lib/admin/transaction-lines";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** A collapsible section of the sidebar — one dropdown per menu group. */
type NavGroup = {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

const ICON_SIZE = 16;

const catalogGroup: NavGroup = {
  key: "catalog",
  label: "Catalog",
  icon: Boxes,
  items: [
    { href: "/admin/catalog/products", label: "Produk", icon: Package },
    { href: "/admin/catalog/packages", label: "Paket", icon: Layers },
    { href: "/admin/catalog/service-types", label: "Tipe Layanan", icon: List },
    { href: "/admin/catalog/price-tiers", label: "Price Tier", icon: Percent },
    { href: "/admin/catalog/places", label: "Place", icon: MapPin },
    { href: "/admin/catalog/service-lines", label: "Service Line", icon: Compass },
    { href: "/admin/catalog/amenities", label: "Amenity", icon: Ticket },
    { href: "/admin/catalog/promos", label: "Promo", icon: Tag },
  ],
};

const operationalGroup: NavGroup = {
  key: "operational",
  label: "Operasional",
  icon: ClipboardList,
  items: [
    { href: "/admin/visa", label: "Pengajuan e-VOA", icon: IdCard },
    { href: "/admin/orders", label: "Orders", icon: FileText },
    { href: "/admin/bookings", label: "Transaksi", icon: ReceiptText },
    { href: "/admin/tour-departures", label: "Departure Tour", icon: Calendar },
    { href: "/admin/roster/drivers", label: "Driver", icon: Users },
    { href: "/admin/roster/vehicles", label: "Vehicle", icon: Van },
  ],
};

/** One transaction menu per service line — icons mirror the service rail. */
const transactionIcons: Record<string, LucideIcon> = {
  transport: Car,
  "tour-package": Compass,
  "fast-track": Ticket,
  "vip-service": Plane,
  evoa: IdCard,
};

const transactionGroup: NavGroup = {
  key: "transactions",
  label: "Transaksi",
  icon: Tickets,
  items: TRANSACTION_LINES.map((line) => ({
    href: `/admin/transactions/${line.slug}`,
    label: line.name,
    icon: transactionIcons[line.slug] ?? List,
  })),
};

const settingsGroup: NavGroup = {
  key: "settings",
  label: "Pengaturan",
  icon: Settings,
  items: [
    { href: "/admin/settings/site-info", label: "Info Situs & Legal", icon: Building2 },
    { href: "/admin/settings/popup", label: "Popup Homepage", icon: FileText },
    { href: "/admin/settings/notifications", label: "Notifikasi Order", icon: Bell },
    { href: "/admin/settings/tax", label: "Pajak", icon: Percent },
    { href: "/admin/settings/evoa-fields", label: "Form Dinamis e-VOA", icon: List },
    { href: "/admin/settings/cancellation", label: "Pembatalan Tour", icon: Ticket },
    { href: "/admin/settings/contract-clauses", label: "Pasal Perjanjian Sewa", icon: FileText },
    { href: "/admin/settings/branding", label: "Branding", icon: Stamp },
  ],
};

const NAV_GROUPS: NavGroup[] = [catalogGroup, operationalGroup, transactionGroup, settingsGroup];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The group that owns the current route, or null when none of them does. */
function groupForPath(pathname: string): string | null {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => isActive(pathname, item.href))) return group.key;
  }
  return null;
}

/**
 * One collapsible section of the sidebar.
 *
 * The panel animates with the `grid-template-rows` 0fr → 1fr trick so the
 * height is driven by its content. When closed the panel is `inert`, which
 * keeps the hidden links out of the tab order and away from screen readers.
 */
function SidebarGroup({
  group,
  open,
  onToggle,
  pathname,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  pathname: string;
}) {
  const Icon = group.icon;
  const hasActive = group.items.some((item) => isActive(pathname, item.href));

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`admin-nav-${group.key}`}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
          hasActive
            ? "font-medium text-[var(--admin-ink)] hover:bg-[var(--admin-hover)]"
            : "text-[var(--admin-muted)] hover:bg-[var(--admin-hover)] hover:text-[var(--admin-ink)]"
        }`}
      >
        <Icon size={ICON_SIZE} className="shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          className={`shrink-0 text-[var(--admin-muted)] transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden" inert={!open}>
          <div
            id={`admin-nav-${group.key}`}
            className="ml-[19px] mt-0.5 border-l border-[var(--admin-line)] py-0.5 pl-2"
          >
            {group.items.map((item) => {
              const ItemIcon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors ${
                    active
                      ? "bg-[var(--admin-hover)] font-medium text-[var(--admin-ink)]"
                      : "text-[var(--admin-muted)] hover:bg-[var(--admin-hover)] hover:text-[var(--admin-ink)]"
                  }`}
                >
                  <ItemIcon size={15} strokeWidth={1.75} className="shrink-0" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Admin sidebar — its own navigation, independent of the public site header.
 *
 * The menu is grouped into collapsible dropdowns; only one group is open at a
 * time and the group owning the current route opens itself on navigation. The
 * open state is deliberately not persisted — it is derived from the route.
 *
 * Active state uses `usePathname()`, the same pattern as `NavBar`.
 */
export default function AdminSidebar() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(() => groupForPath(pathname));

  // Follow the route: land on a page and its group is already open.
  useEffect(() => {
    setOpenGroup(groupForPath(pathname));
  }, [pathname]);

  const toggleGroup = (key: string) => {
    setOpenGroup((current) => (current === key ? null : key));
  };

  return (
    <aside className="hidden h-full w-[240px] shrink-0 flex-col border-r border-[var(--admin-line)] bg-white md:flex">
      <div className="shrink-0 px-6 py-5">
        <Link href="/admin" className="block">
          <span className="text-[13px] font-semibold tracking-[-0.01em]">Booking VIP</span>
          <span className="mt-0.5 block text-[11px] uppercase tracking-[0.08em] text-[var(--admin-muted)]">
            Admin
          </span>
        </Link>
      </div>

      <nav
        aria-label="Admin"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6"
      >
        <Link
          href="/admin"
          aria-current={pathname === "/admin" ? "page" : undefined}
          className={`mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
            pathname === "/admin"
              ? "bg-[var(--admin-hover)] font-medium text-[var(--admin-ink)]"
              : "text-[var(--admin-muted)] hover:bg-[var(--admin-hover)] hover:text-[var(--admin-ink)]"
          }`}
        >
          <LayoutDashboard size={ICON_SIZE} strokeWidth={1.75} className="shrink-0" />
          Dashboard
        </Link>

        {NAV_GROUPS.map((group) => (
          <SidebarGroup
            key={group.key}
            group={group}
            pathname={pathname}
            open={openGroup === group.key}
            onToggle={() => toggleGroup(group.key)}
          />
        ))}
      </nav>
    </aside>
  );
}

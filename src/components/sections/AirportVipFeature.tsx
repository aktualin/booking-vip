"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckIcon, PlaneIcon } from "@/components/icons";
import { useMountedLocale } from "@/lib/useMountedLocale";
import type { DictKey } from "@/i18n";

/** The highlight chips of the panel — dictionary keys, not copy. */
const POINT_KEYS: DictKey[] = [
  "home.vipFeaturePoint1",
  "home.vipFeaturePoint2",
  "home.vipFeaturePoint3",
];

/**
 * The single-service featured panel of the home page — it replaces the old
 * VIP product carousel. One strong CTA card describing the Airport VIP
 * Service (fast track immigration & document handling, arrival to
 * departure) with a "Book now" button into the /airport-vip booking tool.
 *
 * Rendered inside the home page's streamed Suspense boundary, so it reads
 * the locale through `useMountedLocale()` (hydration-safe).
 */
export default function AirportVipFeature({
  href = "/airport-vip",
  titleKey = "home.vipFeatureTitle",
  descKey = "home.vipFeatureDesc",
  ctaKey = "home.vipFeatureCta",
}: {
  href?: string;
  titleKey?: DictKey;
  descKey?: DictKey;
  ctaKey?: DictKey;
}) {
  const { t } = useMountedLocale();

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 p-6 text-white md:p-8">
      {/* Soft glow — no image assets, same language as the hero backdrop. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_92%_-20%,rgba(255,255,255,0.28),transparent_60%)]"
      />

      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <PlaneIcon width={22} height={22} />
            </span>
            <h3 className="text-lg font-extrabold md:text-xl">{t(titleKey)}</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/90 md:text-[15px]">
            {t(descKey)}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {POINT_KEYS.map((key) => (
              <li
                key={key}
                className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold"
              >
                <CheckIcon width={14} height={14} />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>

        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand shadow-sm transition hover:bg-white/90 active:scale-[0.98] md:self-center"
        >
          {t(ctaKey)}
          <ArrowRightIcon width={16} height={16} />
        </Link>
      </div>
    </div>
  );
}
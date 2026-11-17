import "server-only";

import { db } from "@/prisma/db";

/**
 * The operator-configurable brand identity.
 *
 * Lives in the `Setting` table under the JSON key `branding` and is edited in
 * the admin area (Settings → Branding). Every document surface — invoice,
 * payment success, rental agreement — renders the configured app name and
 * falls back to the built-in wordmark when the setting is empty.
 */

export const SETTING_KEY = "branding";

/** The built-in identity used while the setting is empty. */
export const DEFAULT_BRAND = {
  /** The two wordmark halves rendered around the accent dot. */
  nameStart: "Our",
  nameEnd: "Vacation",
  tagline: "Airport Transfer & Travel Services",
} as const;

export type BrandInfo = {
  /** The configured app name, or null when the default wordmark applies. */
  appName: string | null;
  /** The configured tagline, or null for the default one. */
  tagline: string | null;
};

function isBrandInfo(value: unknown): value is Partial<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** Read the branding setting; missing or broken rows fall back to empty. */
export async function getBranding(): Promise<BrandInfo> {
  try {
    const row = await db.orm.public.Setting.select("value")
      .where({ key: SETTING_KEY })
      .first();

    if (!row) return { appName: null, tagline: null };

    const parsed = row.value as unknown;
    if (!isBrandInfo(parsed)) return { appName: null, tagline: null };

    const appName =
      typeof parsed.appName === "string" && parsed.appName.trim()
        ? parsed.appName.trim()
        : null;
    const tagline =
      typeof parsed.tagline === "string" && parsed.tagline.trim()
        ? parsed.tagline.trim()
        : null;

    return { appName, tagline };
  } catch (error) {
    console.error("[branding] could not read the branding setting", error);
    return { appName: null, tagline: null };
  }
}

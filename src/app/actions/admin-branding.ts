"use server";

import { db } from "@/prisma/db";
import { getAdminSession } from "@/lib/admin/session";
import { getBranding, SETTING_KEY, type BrandInfo } from "@/lib/branding";

/**
 * The admin actions of the brand identity (app name + tagline).
 *
 * The values live in the `Setting` key `branding`; empty values mean "use
 * the built-in wordmark", so saving blanks simply removes the override.
 */

export type BrandingResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: string };

/** The current branding for the admin form. */
export async function getBrandingSetting(): Promise<BrandInfo> {
  const session = await getAdminSession();
  if (!session) return { appName: null, tagline: null };
  return getBranding();
}

/** Save the branding override. */
export async function saveBrandingSetting(input: {
  appName: string;
  tagline: string;
}): Promise<BrandingResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Sesi admin tidak valid." };

  const appName = input.appName.trim();
  const tagline = input.tagline.trim();

  if (appName.length > 60) {
    return { ok: false, error: "Nama aplikasi maksimal 60 karakter.", field: "appName" };
  }
  if (tagline.length > 120) {
    return { ok: false, error: "Tagline maksimal 120 karakter.", field: "tagline" };
  }

  const value = {
    appName: appName || null,
    tagline: tagline || null,
  } as unknown;

  const existing = await db.orm.public.Setting.select("key")
    .where({ key: SETTING_KEY })
    .first();

  if (existing) {
    await db.orm.public.Setting.where((f) => f.key.eq(SETTING_KEY)).update({
      value: value as never,
    });
  } else {
    await db.orm.public.Setting.create({
      key: SETTING_KEY,
      value: value as never,
    });
  }

  return { ok: true, message: "Branding tersimpan." };
}

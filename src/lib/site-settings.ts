import { connection } from "next/server";
import { db } from "@/prisma/db";

/**
 * Site identity & legal documents.
 *
 * The configuration lives in the `Setting` table under the key `site.info`
 * as a JSON object, so the admin can change the footer identity, the social
 * links and the legal documents without a deploy:
 *
 *   {
 *     "companyName": "PT Bali VIP Fasttrack",
 *     "address": "Jl. …, Denpasar, Bali",
 *     "instagram": "https://instagram.com/…",
 *     "whatsapp": "62812…",
 *     "facebook": "https://facebook.com/…",
 *     "copyrightText": "© {year} PT Bali VIP Fasttrack. All rights reserved.",
 *     "termsHtml": "<h2>…</h2>",
 *     "privacyHtml": "<h2>…</h2>"
 *   }
 */

export const SITE_INFO_SETTING_KEY = "site.info";

export type SiteInfoDTO = {
  /** The registered company name (nama PT). */
  companyName: string;
  /** The company address shown in the footer. */
  address: string;
  /** Instagram profile URL. */
  instagram: string;
  /** WhatsApp number or URL — normalised to a `wa.me` link when rendered. */
  whatsapp: string;
  /** Facebook page URL. */
  facebook: string;
  /**
   * The copyright line. `{year}` is replaced with the current year and
   * `{company}` with the company name at render time.
   */
  copyrightText: string;
  /** Terms of Service content (HTML from the rich-text editor). */
  termsHtml: string;
  /** Privacy Policy content (HTML from the rich-text editor). */
  privacyHtml: string;
};

/** The configuration used when nothing has been saved yet. */
export const DEFAULT_SITE_INFO: SiteInfoDTO = {
  companyName: "",
  address: "",
  instagram: "",
  whatsapp: "",
  facebook: "",
  copyrightText: "© {year} {company}. All rights reserved.",
  termsHtml: "",
  privacyHtml: "",
};

/** Read a string field from the stored JSON value. */
function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Normalise a raw JSON value into the site-info configuration. */
export function parseSiteInfo(raw: unknown): SiteInfoDTO {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SITE_INFO };
  }

  const value = raw as Record<string, unknown>;
  const social = (value.social && typeof value.social === "object"
    ? value.social
    : value) as Record<string, unknown>;

  return {
    companyName: readString(value.companyName, DEFAULT_SITE_INFO.companyName).trim(),
    address: readString(value.address, DEFAULT_SITE_INFO.address).trim(),
    instagram: readString(social.instagram ?? value.instagram, "").trim(),
    whatsapp: readString(social.whatsapp ?? value.whatsapp, "").trim(),
    facebook: readString(social.facebook ?? value.facebook, "").trim(),
    copyrightText: readString(value.copyrightText, DEFAULT_SITE_INFO.copyrightText).trim(),
    termsHtml: readString(value.termsHtml, ""),
    privacyHtml: readString(value.privacyHtml, ""),
  };
}

/**
 * Read the site-info configuration from the database.
 *
 * A database problem must never break the public footer — the defaults are
 * returned instead.
 */
export async function getSiteInfo(): Promise<SiteInfoDTO> {
  // The footer reads this on every page, including pages that used to
  // prerender — opting into a request-time render keeps the configured
  // identity (and the copyright year) always fresh. Deliberately outside
  // the try/catch: swallowing the dynamic-render signal would silently
  // prerender pages with the default footer.
  await connection();

  try {
    const rows = await db.orm.public.Setting
      .select("key", "value")
      .where({ key: SITE_INFO_SETTING_KEY })
      .all();

    const raw = rows[0]?.value;
    if (raw == null) return { ...DEFAULT_SITE_INFO };

    return parseSiteInfo(raw);
  } catch {
    return { ...DEFAULT_SITE_INFO };
  }
}

/**
 * Save the site-info configuration.
 *
 * The row is created when it does not exist yet and updated otherwise, so
 * the key stays unique.
 */
export async function saveSiteInfo(info: SiteInfoDTO): Promise<void> {
  const value = {
    companyName: info.companyName,
    address: info.address,
    social: {
      instagram: info.instagram,
      whatsapp: info.whatsapp,
      facebook: info.facebook,
    },
    copyrightText: info.copyrightText,
    termsHtml: info.termsHtml,
    privacyHtml: info.privacyHtml,
  };

  const existing = await db.orm.public.Setting
    .select("key")
    .where({ key: SITE_INFO_SETTING_KEY })
    .first();

  if (existing) {
    await db.orm.public.Setting
      .where({ key: SITE_INFO_SETTING_KEY })
      .update({ value: value as never });
    return;
  }

  await db.orm.public.Setting.create({
    key: SITE_INFO_SETTING_KEY,
    value: value as never,
  });
}

/**
 * Turn the stored WhatsApp value into a clickable link.
 *
 * Accepts a full URL (`https://wa.me/…`, `https://api.whatsapp.com/…`) or a
 * bare phone number — Indonesian leading zeros become the `62` country code.
 * Returns null when the value cannot produce a link.
 */
export function whatsAppLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) return value;

  const digits = value.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;

  // Local Indonesian format: 08xx → 628xx.
  const normalised = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return `https://wa.me/${normalised}`;
}

/**
 * Render the copyright line: `{year}` becomes the current year and
 * `{company}` the configured company name (falling back to the built-in
 * brand when no company was set).
 */
export function renderCopyright(
  text: string,
  companyName: string,
  now: Date = new Date(),
): string {
  const company = companyName.trim() || "Bali VIP Fasttrack";
  const template = text.trim() || DEFAULT_SITE_INFO.copyrightText;

  return template
    .replace(/\{year\}/gi, String(now.getFullYear()))
    .replace(/\{company\}/gi, company);
}

"use server";

import { getAdminSession } from "@/lib/admin/session";
import {
  DEFAULT_SITE_INFO,
  getSiteInfo,
  parseSiteInfo,
  saveSiteInfo,
  whatsAppLink,
  type SiteInfoDTO,
} from "@/lib/site-settings";

/**
 * The admin actions of the site identity & legal documents.
 *
 * Both are gated by the admin session — the same check the rest of the admin
 * area uses. The layout already guards the page, but an action can be called
 * directly, so the check is repeated here.
 */

export type SiteInfoSaveResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: string };

/** Read the site-info configuration for the admin form. */
export async function loadSiteInfo(): Promise<SiteInfoDTO> {
  const session = await getAdminSession();
  if (!session) return { ...DEFAULT_SITE_INFO };
  return getSiteInfo();
}

/** Is the value a plausible http(s) URL? */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Save the site-info configuration.
 *
 * The values arrive as plain strings from the form: social links have to be
 * real URLs (WhatsApp also accepts a bare phone number), and the legal
 * documents are capped so a runaway paste cannot blow up the settings row.
 */
export async function saveSiteInfoAction(
  values: Record<string, unknown>,
): Promise<SiteInfoSaveResult> {
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, error: "Sesi admin tidak valid. Silakan masuk ulang." };
  }

  const str = (key: string) => String(values[key] ?? "").trim();

  const instagram = str("instagram");
  if (instagram && !isHttpUrl(instagram)) {
    return {
      ok: false,
      error: "URL Instagram harus diawali http:// atau https://.",
      field: "instagram",
    };
  }

  const facebook = str("facebook");
  if (facebook && !isHttpUrl(facebook)) {
    return {
      ok: false,
      error: "URL Facebook harus diawali http:// atau https://.",
      field: "facebook",
    };
  }

  const whatsapp = str("whatsapp");
  if (whatsapp && !whatsAppLink(whatsapp)) {
    return {
      ok: false,
      error: "Nomor WhatsApp tidak valid — isi nomor (mis. 0812…) atau URL wa.me.",
      field: "whatsapp",
    };
  }

  const termsHtml = String(values.termsHtml ?? "");
  const privacyHtml = String(values.privacyHtml ?? "");

  if (termsHtml.length > 500_000 || privacyHtml.length > 500_000) {
    return {
      ok: false,
      error: "Dokumen terlalu besar (maksimal ±500 ribu karakter).",
    };
  }

  try {
    await saveSiteInfo(
      parseSiteInfo({
        companyName: str("companyName"),
        address: str("address"),
        social: { instagram, whatsapp, facebook },
        copyrightText: str("copyrightText"),
        termsHtml,
        privacyHtml,
      }),
    );
  } catch {
    return { ok: false, error: "Gagal menyimpan pengaturan situs." };
  }

  return { ok: true, message: "Pengaturan situs berhasil disimpan." };
}

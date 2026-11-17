"use client";

import { useEffect, useState } from "react";
import {
  loadSiteInfo,
  saveSiteInfoAction,
} from "@/app/actions/site-info-admin";
import type { SiteInfoDTO } from "@/lib/site-settings";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";
import RichTextEditor from "@/components/admin/RichTextEditor";
import { FacebookIcon, InstagramIcon, WhatsAppIcon } from "@/components/icons";

/**
 * Site identity & legal documents.
 *
 * A single record, so there is no list page — the form is the page. The
 * operator sets the company identity shown in the footer (name, address,
 * social links, copyright line) and writes the Terms of Service and the
 * Privacy Policy in the rich-text editor.
 */

/** Live copyright preview — mirrors `renderCopyright` from the server lib. */
function previewCopyright(text: string, company: string): string {
  const template = text.trim() || "© {year} {company}. All rights reserved.";
  return template
    .replace(/\{year\}/gi, String(new Date().getFullYear()))
    .replace(/\{company\}/gi, company.trim() || "Bali VIP Fasttrack");
}

export default function SiteInfoForm() {
  const [values, setValues] = useState<SiteInfoDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const settings = await loadSiteInfo();
      setValues(settings);
    })();
  }, []);

  if (!values) {
    return (
      <div className={`${adminClass.panel} px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]`}>
        Memuat data…
      </div>
    );
  }

  const set = <K extends keyof SiteInfoDTO>(key: K, value: SiteInfoDTO[K]) => {
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
    setFieldError(undefined);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    setFieldError(undefined);

    const result = await saveSiteInfoAction({
      companyName: values.companyName,
      address: values.address,
      instagram: values.instagram,
      whatsapp: values.whatsapp,
      facebook: values.facebook,
      copyrightText: values.copyrightText,
      termsHtml: values.termsHtml,
      privacyHtml: values.privacyHtml,
    });

    if (!result.ok) {
      setError(result.error);
      setFieldError(result.field);
      setSaving(false);
      return;
    }

    showAdminToast(result.message);
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="pb-6">
      <div className="mb-5">
        <h1 className={adminClass.h1}>Info Situs &amp; Legal</h1>
        <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
          Identitas perusahaan, sosial media, copyright di footer, serta
          dokumen Terms of Service dan Privacy Policy. Tersimpan di database
          dan langsung berlaku.
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      {/* — Perusahaan — */}
      <section className={`${adminClass.panel} p-5 sm:p-6`}>
        <h2 className="mb-4 text-[14px] font-semibold text-[var(--admin-ink)]">
          Perusahaan
        </h2>
        <div className="grid grid-cols-1 gap-4">
          <label className="block">
            <span className={adminClass.label}>Nama PT</span>
            <input
              type="text"
              value={values.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              placeholder="PT Bali VIP Fasttrack"
              className={`${adminClass.input} mt-1.5`}
            />
          </label>

          <label className="block">
            <span className={adminClass.label}>Alamat</span>
            <textarea
              rows={3}
              value={values.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Jl. By Pass Ngurah Rai No. …, Kuta, Badung, Bali 80361"
              className={`${adminClass.input} mt-1.5 h-auto py-2`}
            />
            <span className="mt-1 block text-[12px] text-[var(--admin-muted)]">
              Ditampilkan di footer situs.
            </span>
          </label>
        </div>
      </section>

      {/* — Sosial media — */}
      <section className={`${adminClass.panel} mt-5 p-5 sm:p-6`}>
        <h2 className="mb-4 text-[14px] font-semibold text-[var(--admin-ink)]">
          Sosial Media
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className={adminClass.label}>
              <span className="inline-flex items-center gap-1.5">
                <InstagramIcon size={13} /> Instagram
              </span>
            </span>
            <input
              type="text"
              value={values.instagram}
              onChange={(e) => set("instagram", e.target.value)}
              placeholder="https://instagram.com/balivip"
              className={`${adminClass.input} mt-1.5 ${fieldError === "instagram" ? "border-danger" : ""}`}
            />
          </label>

          <label className="block">
            <span className={adminClass.label}>
              <span className="inline-flex items-center gap-1.5">
                <WhatsAppIcon size={13} /> WhatsApp
              </span>
            </span>
            <input
              type="text"
              value={values.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
              placeholder="0812 3456 7890 atau https://wa.me/62812…"
              className={`${adminClass.input} mt-1.5 ${fieldError === "whatsapp" ? "border-danger" : ""}`}
            />
            <span className="mt-1 block text-[12px] text-[var(--admin-muted)]">
              Nomor otomatis diubah jadi link wa.me.
            </span>
          </label>

          <label className="block">
            <span className={adminClass.label}>
              <span className="inline-flex items-center gap-1.5">
                <FacebookIcon size={13} /> Facebook
              </span>
            </span>
            <input
              type="text"
              value={values.facebook}
              onChange={(e) => set("facebook", e.target.value)}
              placeholder="https://facebook.com/balivip"
              className={`${adminClass.input} mt-1.5 ${fieldError === "facebook" ? "border-danger" : ""}`}
            />
          </label>
        </div>
        <p className="mt-3 text-[12px] text-[var(--admin-muted)]">
          Ikon hanya muncul di footer kalau link-nya diisi.
        </p>
      </section>

      {/* — Copyright — */}
      <section className={`${adminClass.panel} mt-5 p-5 sm:p-6`}>
        <h2 className="mb-4 text-[14px] font-semibold text-[var(--admin-ink)]">
          Copyright
        </h2>
        <label className="block">
          <span className={adminClass.label}>Teks copyright</span>
          <input
            type="text"
            value={values.copyrightText}
            onChange={(e) => set("copyrightText", e.target.value)}
            placeholder="© {year} {company}. All rights reserved."
            className={`${adminClass.input} mt-1.5`}
          />
          <span className="mt-1 block text-[12px] text-[var(--admin-muted)]">
            Placeholder: <code className="font-mono">{"{year}"}</code> = tahun
            saat ini (otomatis), <code className="font-mono">{"{company}"}</code>{" "}
            = nama PT di atas.
          </span>
        </label>
        <p className="mt-3 rounded-lg bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-[var(--admin-muted)]">
          Pratinjau:{" "}
          <span className="font-medium text-[var(--admin-ink)]">
            {previewCopyright(values.copyrightText, values.companyName)}
          </span>
        </p>
      </section>

      {/* — Dokumen legal — */}
      <section className={`${adminClass.panel} mt-5 p-5 sm:p-6`}>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--admin-ink)]">
          Dokumen Legal
        </h2>
        <p className="mb-4 text-[12px] text-[var(--admin-muted)]">
          Ditulis seperti dokumen biasa — judul bagian, daftar, dan tautan
          lewat toolbar. Muncul di halaman publik{" "}
          <code className="font-mono">/terms</code> dan{" "}
          <code className="font-mono">/privacy</code>, ditautkan dari footer.
        </p>

        <div className="space-y-6">
          <div>
            <span className={`${adminClass.label} mb-1.5 block`}>
              Terms of Service
            </span>
            <RichTextEditor
              value={values.termsHtml}
              onChange={(html) => set("termsHtml", html)}
              placeholder="Tulis Syarat & Ketentuan layanan di sini…"
            />
          </div>

          <div>
            <span className={`${adminClass.label} mb-1.5 block`}>
              Privacy Policy
            </span>
            <RichTextEditor
              value={values.privacyHtml}
              onChange={(html) => set("privacyHtml", html)}
              placeholder="Tulis Kebijakan Privasi di sini…"
            />
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 z-40 mt-5 flex items-center justify-end gap-2 border-t border-[var(--admin-line)] bg-white py-3">
        <button type="submit" disabled={saving} className={adminClass.buttonPrimary}>
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  getBrandingSetting,
  saveBrandingSetting,
} from "@/app/actions/admin-branding";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";

/**
 * The admin form of the brand identity shown on the documents
 * (invoice, payment success, rental agreement). Empty values fall back to
 * the built-in "Our•Vacation" wordmark.
 */
export default function BrandingSettingsForm() {
  const [appName, setAppName] = useState("");
  const [tagline, setTagline] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getBrandingSetting().then((brand) => {
      setAppName(brand.appName ?? "");
      setTagline(brand.tagline ?? "");
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const result = await saveBrandingSetting({ appName, tagline });
    setSaving(false);
    if (!result.ok) {
      showAdminToast(result.error, "error");
      return;
    }
    showAdminToast(result.message, "success");
  };

  return (
    <div className={adminClass.page}>
      <h1 className={adminClass.h1}>Branding</h1>
      <p className="mt-1 max-w-[640px] text-[13px] text-[var(--admin-muted)]">
        Nama aplikasi dan tagline yang tampil di dokumen pelanggan (invoice,
        halaman pembayaran berhasil, perjanjian sewa). Kosongkan untuk memakai
        wordmark bawaan.
      </p>

      <div className={`${adminClass.panel} mt-5 max-w-[560px] space-y-4 p-5`}>
        <label className="block">
          <span className={adminClass.label}>Nama aplikasi</span>
          <input
            className={`${adminClass.input} mt-1.5`}
            value={appName}
            disabled={!loaded}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="OurVacation (default)"
          />
        </label>
        <label className="block">
          <span className={adminClass.label}>Tagline</span>
          <input
            className={`${adminClass.input} mt-1.5`}
            value={tagline}
            disabled={!loaded}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Airport Transfer & Travel Services (default)"
          />
        </label>

        <div className="flex justify-end">
          <button
            type="button"
            className={adminClass.buttonPrimary}
            disabled={!loaded || saving}
            onClick={() => void save()}
          >
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

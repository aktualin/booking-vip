"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getTourCancellationPolicy,
  saveTourCancellationPolicy,
} from "@/app/actions/settings-tour";
import type { CancellationPolicy, CancellationTier } from "@/lib/cancellation-policy";
import { DEFAULT_CANCELLATION_POLICY } from "@/lib/cancellation-policy";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert hours to a human-readable days+hours string. */
function hoursToLabel(hours: number): string {
  if (hours === 0) return "0 jam (< 1 hari)";
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  if (remainder === 0) {
    return `${days} hari (${hours} jam)`;
  }
  return `${days} hari ${remainder} jam (${hours} jam)`;
}

/** Build the tier label matching cancellation.ts buildTierLabel logic. */
function tierPreviewLabel(tier: CancellationTier): string {
  if (tier.minHoursBefore === 0) {
    return `<1 hari sebelum → refund ${tier.refundPercent}%`;
  }
  const days = tier.minHoursBefore / 24;
  if (Number.isInteger(days)) {
    return `≥${days} hari sebelum → refund ${tier.refundPercent}%`;
  }
  return `≥${tier.minHoursBefore} jam sebelum → refund ${tier.refundPercent}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CancellationSettingsForm() {
  const [tiers, setTiers] = useState<CancellationTier[]>(
    DEFAULT_CANCELLATION_POLICY.tiers,
  );
  const [defaultRefund, setDefaultRefund] = useState(
    DEFAULT_CANCELLATION_POLICY.defaultRefundPercent,
  );
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load the current policy on mount.
  const load = useCallback(async () => {
    try {
      const policy = await getTourCancellationPolicy();
      setTiers(policy.tiers);
      setDefaultRefund(policy.defaultRefundPercent);
    } catch {
      // Keep defaults on error.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- Tier CRUD ---

  const updateTier = (index: number, field: keyof CancellationTier, value: number) => {
    setTiers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, [field]: value };
      return next;
    });
  };

  const addTier = () => {
    setTiers((prev) => [...prev, { minHoursBefore: 0, refundPercent: 0 }]);
  };

  const removeTier = (index: number) => {
    setTiers((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Save ---

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);

    // Sort descending by minHoursBefore before saving.
    const sorted = [...tiers].sort(
      (a, b) => b.minHoursBefore - a.minHoursBefore,
    );

    const policy: CancellationPolicy = {
      tiers: sorted,
      defaultRefundPercent: defaultRefund,
    };

    const result = await saveTourCancellationPolicy(policy);
    if (result.ok) {
      showAdminToast("Kebijakan pembatalan disimpan.");
      // Re-sort the local state to match what was saved.
      setTiers(sorted);
    } else {
      showAdminToast(result.error, "error");
    }
    setSaving(false);
  };

  if (!loaded) {
    return (
      <p className="px-2 py-10 text-[13px] text-[var(--admin-muted)]">
        Memuat…
      </p>
    );
  }

  return (
    <div className="pb-6">
      <div className="mb-5">
        <h1 className={adminClass.h1}>Pembatalan Tour</h1>
        <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
          Kebijakan refund bertingkat berdasarkan waktu pembatalan relatif
          terhadap tanggal layanan. Tier diurutkan otomatis dari jam terbesar
          ke terkecil saat disimpan.
        </p>
      </div>

      {/* Tier list */}
      <div className={`${adminClass.panel} mb-5 p-5`}>
        <div className="mb-3 flex items-center justify-between">
          <span className={adminClass.label}>Tier Pembatalan</span>
          <button
            type="button"
            className={adminClass.buttonSecondary}
            onClick={addTier}
          >
            + Tambah Tier
          </button>
        </div>

        {tiers.length === 0 ? (
          <p className="text-[13px] text-[var(--admin-muted)]">
            Belum ada tier. Tambahkan minimal satu.
          </p>
        ) : (
          <div className="space-y-3">
            {tiers.map((tier, index) => (
              <div
                key={index}
                className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2"
              >
                <label className="block flex-1 min-w-[140px]">
                  <span className={adminClass.label}>Min Jam Sebelum</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={tier.minHoursBefore}
                    onChange={(e) =>
                      updateTier(
                        index,
                        "minHoursBefore",
                        Math.max(0, parseInt(e.target.value, 10) || 0),
                      )
                    }
                    className={`${adminClass.input} mt-1`}
                  />
                  <span className="mt-0.5 block text-[11px] text-[var(--admin-muted)]">
                    {hoursToLabel(tier.minHoursBefore)}
                  </span>
                </label>

                <label className="block w-[120px]">
                  <span className={adminClass.label}>Refund %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={tier.refundPercent}
                    onChange={(e) =>
                      updateTier(
                        index,
                        "refundPercent",
                        Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)),
                      )
                    }
                    className={`${adminClass.input} mt-1`}
                  />
                </label>

                <button
                  type="button"
                  className={`${adminClass.buttonGhost} text-danger`}
                  onClick={() => removeTier(index)}
                  title="Hapus tier"
                >
                  Hapus
                </button>
              </div>
            ))}
          </div>
        )}

        <label className="mt-4 block">
          <span className={adminClass.label}>Default Refund %</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={defaultRefund}
            onChange={(e) =>
              setDefaultRefund(
                Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)),
              )
            }
            className={`${adminClass.input} mt-1 w-[120px]`}
          />
          <span className="mt-0.5 block text-[11px] text-[var(--admin-muted)]">
            Digunakan ketika tidak ada tier yang cocok.
          </span>
        </label>

        <div className="mt-4">
          <button
            type="button"
            className={adminClass.buttonPrimary}
            disabled={saving || tiers.length === 0}
            onClick={handleSave}
          >
            {saving ? "Menyimpan…" : "Simpan Kebijakan"}
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className={`${adminClass.panel} p-5`}>
        <h3 className={adminClass.label}>Preview Label</h3>
        <p className="mb-2 text-[12px] text-[var(--admin-muted)]">
          Bagaimana tier ditampilkan kepada admin saat pembatalan.
        </p>
        {tiers.length === 0 ? (
          <p className="text-[13px] text-[var(--admin-muted)]">
            Tidak ada tier untuk dipreview.
          </p>
        ) : (
          <ul className="space-y-1">
            {[...tiers]
              .sort((a, b) => b.minHoursBefore - a.minHoursBefore)
              .map((tier, i) => (
                <li
                  key={i}
                  className="rounded bg-[var(--admin-hover)] px-3 py-1.5 text-[13px]"
                >
                  {tierPreviewLabel(tier)}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

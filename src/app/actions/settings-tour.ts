"use server";

import { db } from "@/prisma/db";
import { assertAdmin } from "./admin";
import {
  getCancellationPolicy,
  type CancellationPolicy,
} from "@/lib/cancellation";

// ---------------------------------------------------------------------------
// getTourCancellationPolicy
// ---------------------------------------------------------------------------

/** Admin-gated wrapper around getCancellationPolicy. */
export async function getTourCancellationPolicy(): Promise<CancellationPolicy> {
  await assertAdmin();
  return getCancellationPolicy();
}

// ---------------------------------------------------------------------------
// saveTourCancellationPolicy
// ---------------------------------------------------------------------------

const SETTING_KEY = "tour_cancellation_policy";

/**
 * Validate and persist the cancellation policy tiers.
 *
 * Rules:
 *   - At least one tier required.
 *   - Tiers must be sorted descending by minHoursBefore.
 *   - refundPercent must be an integer 0–100.
 *   - minHoursBefore must be a non-negative integer.
 */
export async function saveTourCancellationPolicy(
  policy: CancellationPolicy,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin();
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "admin unauthorized",
    };
  }

  // --- Validate tiers ---
  if (!Array.isArray(policy.tiers) || policy.tiers.length === 0) {
    return { ok: false, error: "Minimal satu tier pembatalan diperlukan." };
  }

  for (let i = 0; i < policy.tiers.length; i++) {
    const tier = policy.tiers[i];
    if (!tier || typeof tier !== "object") {
      return { ok: false, error: `Tier #${i + 1} tidak valid.` };
    }
    if (
      typeof tier.minHoursBefore !== "number" ||
      !Number.isInteger(tier.minHoursBefore) ||
      tier.minHoursBefore < 0
    ) {
      return {
        ok: false,
        error: `Tier #${i + 1}: minHoursBefore harus bilangan bulat ≥ 0.`,
      };
    }
    if (
      typeof tier.refundPercent !== "number" ||
      !Number.isInteger(tier.refundPercent) ||
      tier.refundPercent < 0 ||
      tier.refundPercent > 100
    ) {
      return {
        ok: false,
        error: `Tier #${i + 1}: refundPercent harus bilangan bulat 0–100.`,
      };
    }
  }

  // Must be sorted descending by minHoursBefore.
  for (let i = 1; i < policy.tiers.length; i++) {
    if (policy.tiers[i]!.minHoursBefore >= policy.tiers[i - 1]!.minHoursBefore) {
      return {
        ok: false,
        error: "Tier harus diurutkan dari jam terbesar ke terkecil (descending).",
      };
    }
  }

  // Validate defaultRefundPercent.
  if (
    typeof policy.defaultRefundPercent !== "number" ||
    !Number.isInteger(policy.defaultRefundPercent) ||
    policy.defaultRefundPercent < 0 ||
    policy.defaultRefundPercent > 100
  ) {
    return {
      ok: false,
      error: "defaultRefundPercent harus bilangan bulat 0–100.",
    };
  }

  // --- Upsert ---
  const value = {
    tiers: policy.tiers.map((t) => ({
      minHoursBefore: t.minHoursBefore,
      refundPercent: t.refundPercent,
    })),
    defaultRefundPercent: policy.defaultRefundPercent,
  } as never;

  const existing = await db.orm.public.Setting
    .select("key")
    .where({ key: SETTING_KEY })
    .first();

  if (existing) {
    await db.orm.public.Setting
      .where({ key: SETTING_KEY })
      .update({ value });
  } else {
    await db.orm.public.Setting.create({
      key: SETTING_KEY,
      value,
    });
  }

  return { ok: true };
}

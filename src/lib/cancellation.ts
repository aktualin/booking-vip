import "server-only";

import { db } from "@/prisma/db";
import {
  DEFAULT_CANCELLATION_POLICY,
  type CancellationPolicy,
  type CancellationTier,
} from "./cancellation-policy";

// Types + the default policy live in the plain (client-safe) module
// "./cancellation-policy" and are re-exported here so existing server-side
// importers keep working unchanged.
export { DEFAULT_CANCELLATION_POLICY };
export type { CancellationPolicy, CancellationTier };

// ---------------------------------------------------------------------------
// Setting key
// ---------------------------------------------------------------------------

const SETTING_KEY = "tour_cancellation_policy";

// ---------------------------------------------------------------------------
// getCancellationPolicy
// ---------------------------------------------------------------------------

/**
 * Read the cancellation policy from the Setting table.
 * Falls back to the Bali-standard default when no row exists.
 */
export async function getCancellationPolicy(): Promise<CancellationPolicy> {
  try {
    const row = await db.orm.public.Setting
      .select("value")
      .where({ key: SETTING_KEY })
      .first();

    if (!row) return DEFAULT_CANCELLATION_POLICY;

    const parsed = row.value as unknown;
    if (isCancellationPolicy(parsed)) return parsed;

    // Corrupted data — fall back silently.
    return DEFAULT_CANCELLATION_POLICY;
  } catch {
    return DEFAULT_CANCELLATION_POLICY;
  }
}

// ---------------------------------------------------------------------------
// computeRefund
// ---------------------------------------------------------------------------

export type RefundResult = {
  refundUsdCents: number;
  refundPercent: number;
  tierLabel: string;
};

/**
 * Compute the refund for a booking based on hours until serviceAt.
 *
 * Tiers are evaluated in descending minHoursBefore order — the first tier
 * whose threshold the booking still meets wins.
 */
export function computeRefund(
  serviceAt: Date,
  totalUsdCents: number,
  policy?: CancellationPolicy,
): RefundResult {
  const p = policy ?? DEFAULT_CANCELLATION_POLICY;
  const now = new Date();
  const hoursUntil = (serviceAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Find the applicable tier — tiers must be sorted descending.
  let matched: CancellationTier | undefined;
  for (const tier of p.tiers) {
    if (hoursUntil >= tier.minHoursBefore) {
      matched = tier;
      break;
    }
  }

  const refundPercent = matched?.refundPercent ?? p.defaultRefundPercent;
  const refundUsdCents = Math.round((totalUsdCents * refundPercent) / 100);
  const tierLabel = buildTierLabel(refundPercent, matched?.minHoursBefore);

  return { refundUsdCents, refundPercent, tierLabel };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a human-readable Indonesian label for the matched tier. */
function buildTierLabel(refundPercent: number, minHoursBefore?: number): string {
  if (minHoursBefore == null) {
    return `Refund ${refundPercent}%`;
  }
  if (minHoursBefore === 0) {
    return `<1 hari sebelum → refund ${refundPercent}%`;
  }
  const days = minHoursBefore / 24;
  if (Number.isInteger(days)) {
    return `≥${days} hari sebelum → refund ${refundPercent}%`;
  }
  return `≥${minHoursBefore} jam sebelum → refund ${refundPercent}%`;
}

/** Runtime guard — validates the shape stored in the Setting JSON column. */
function isCancellationPolicy(value: unknown): value is CancellationPolicy {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.tiers)) return false;
  if (typeof obj.defaultRefundPercent !== "number") return false;
  for (const tier of obj.tiers) {
    if (!tier || typeof tier !== "object") return false;
    const t = tier as Record<string, unknown>;
    if (typeof t.minHoursBefore !== "number") return false;
    if (typeof t.refundPercent !== "number") return false;
  }
  return true;
}

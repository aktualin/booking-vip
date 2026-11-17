// Cancellation policy types + the default policy.
//
// Deliberately plain (NO "server-only", NO database imports) so Client
// Components — e.g. the admin cancellation settings form — can import the
// types and the default without dragging the server runtime into the browser
// bundle. The server-side read/compute logic lives in "./cancellation.ts",
// which re-exports everything from here.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CancellationTier = {
  /** Minimum hours before serviceAt to qualify for this tier's refund. */
  minHoursBefore: number;
  /** Refund percentage (0–100). */
  refundPercent: number;
};

export type CancellationPolicy = {
  /** Tiers sorted descending by minHoursBefore (most generous first). */
  tiers: CancellationTier[];
  /** Fallback when no tier matches (should not happen with a 0-hour tier). */
  defaultRefundPercent: number;
};

// ---------------------------------------------------------------------------
// Default Bali-standard policy
// ---------------------------------------------------------------------------

/**
 * Bali operator standard cancellation tiers:
 *   ≥7 days (168 h) → 100% refund
 *   ≥3 days (72 h)  → 50% refund
 *   ≥1 day  (24 h)  → 25% refund
 *   <1 day  (0 h)   → 0% refund
 */
export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  tiers: [
    { minHoursBefore: 168, refundPercent: 100 },
    { minHoursBefore: 72, refundPercent: 50 },
    { minHoursBefore: 24, refundPercent: 25 },
    { minHoursBefore: 0, refundPercent: 0 },
  ],
  defaultRefundPercent: 0,
};

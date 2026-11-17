import "server-only";

import { db } from "@/prisma/db";
import { getUsdToIdrRate } from "@/lib/fx";

/**
 * e-VOA pricing.
 *
 * The service fee is ours (USD cents, operator-tunable). The official
 * immigration fee is fixed in IDR by the government, so it is converted to
 * USD cents with the live USD→IDR rate at quote time. The quote is a pure
 * snapshot: the booking stores the resulting USD-cent totals, and the payment
 * pipeline later converts them back to IDR at its own frozen rate.
 *
 * Every knob lives in the `Setting` table so ops can tune fees/limits without
 * a deploy. Missing or malformed values fall back to the seeded defaults —
 * pricing never fails because of a bad settings row.
 */

export type EvoaSettings = {
  officialFeeIdr: number;
  serviceFeeUsdCents: number;
  maxApplicants: number;
  slaHours: number;
  minLeadTimeDays: number;
};

/** The seeded defaults — used whenever a Setting row is missing or invalid. */
const DEFAULT_SETTINGS: EvoaSettings = {
  officialFeeIdr: 500000,
  serviceFeeUsdCents: 1500,
  maxApplicants: 5,
  slaHours: 24,
  minLeadTimeDays: 2,
};

/**
 * Read one numeric Setting, tolerating a missing row or a non-numeric value.
 * Never throws — a database hiccup degrades to the default, not an error.
 */
async function readNumberSetting(key: string, fallback: number): Promise<number> {
  try {
    const row = await db.orm.public.Setting
      .select("value")
      .where({ key })
      .first();

    const raw = row?.value;
    // The seed stores a bare number; accept a numeric string too in case an
    // operator typed one into the admin. Anything else is treated as invalid.
    const parsed =
      typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** The current e-VOA settings, with defaults for anything missing/invalid. */
export async function getEvoaSettings(): Promise<EvoaSettings> {
  const [officialFeeIdr, serviceFeeUsdCents, maxApplicants, slaHours, minLeadTimeDays] =
    await Promise.all([
      readNumberSetting("evoa.officialFeeIdr", DEFAULT_SETTINGS.officialFeeIdr),
      readNumberSetting("evoa.serviceFeeUsdCents", DEFAULT_SETTINGS.serviceFeeUsdCents),
      readNumberSetting("evoa.maxApplicants", DEFAULT_SETTINGS.maxApplicants),
      readNumberSetting("evoa.slaHours", DEFAULT_SETTINGS.slaHours),
      readNumberSetting("evoa.minLeadTimeDays", DEFAULT_SETTINGS.minLeadTimeDays),
    ]);

  return { officialFeeIdr, serviceFeeUsdCents, maxApplicants, slaHours, minLeadTimeDays };
}

export type EvoaQuote = {
  applicantCount: number;
  serviceFeeUsdCents: number;
  officialFeeIdr: number;
  officialFeeUsdCents: number;
  unitUsdCents: number;
  totalUsdCents: number;
  /** The USD→IDR rate used to convert the official fee (for display/audit). */
  rate: number;
};

/**
 * Price an e-VOA order for `applicantCount` people.
 *
 * The official IDR fee is converted to USD cents once, per applicant; the
 * per-person unit is service + official, and the total is unit × count. The
 * rate comes from the same source the payment pipeline uses, so the quote and
 * the eventual charge stay consistent.
 */
export async function quoteEvoa(applicantCount: number): Promise<EvoaQuote> {
  const settings = await getEvoaSettings();
  const rate = await getUsdToIdrRate();

  const officialFeeUsdCents = Math.round((settings.officialFeeIdr / rate) * 100);
  const unitUsdCents = settings.serviceFeeUsdCents + officialFeeUsdCents;
  const totalUsdCents = unitUsdCents * applicantCount;

  return {
    applicantCount,
    serviceFeeUsdCents: settings.serviceFeeUsdCents,
    officialFeeIdr: settings.officialFeeIdr,
    officialFeeUsdCents,
    unitUsdCents,
    totalUsdCents,
    rate,
  };
}
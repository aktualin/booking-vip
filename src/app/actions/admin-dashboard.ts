"use server";

import { db } from "@/prisma/db";
import { assertAdmin } from "./admin";
import type {
  AdminBookingStatus,
  AdminDashboardData,
  DashboardBucket,
  DashboardPoint,
} from "@/types/admin";

/**
 * The analytics behind the admin dashboard charts.
 *
 * Everything is aggregated from real `Booking` rows (plus their items'
 * products for the per-line and per-product breakdowns) over the last
 * 12 months. "Revenue" counts completed + confirmed bookings — the two
 * statuses where the money is real; cancelled and awaiting_payment are
 * excluded from revenue but still counted as bookings.
 */

const REVENUE_STATUSES = new Set(["completed", "confirmed"]);
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function isBookingStatus(value: unknown): value is AdminBookingStatus {
  return (
    value === "awaiting_payment" ||
    value === "confirmed" ||
    value === "completed" ||
    value === "cancelled"
  );
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  await assertAdmin();

  const now = new Date();
  // First day of the month 11 months back → a rolling 12-month window.
  const since = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const daySince = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);

  const [bookings, lines] = await Promise.all([
    db.orm.public.Booking
      .select("id", "status", "createdAt", "totalUsdCents")
      .where((b) => b.createdAt.gte(since))
      .include("items", (i) =>
        i
          .select("label", "totalUsdCents")
          .include("product", (p) => p.select("title", "lineId")),
      )
      .all(),
    db.orm.public.ServiceLine.select("id", "label").all(),
  ]);

  const lineLabel = new Map(lines.map((l) => [l.id, l.label]));

  // ----- monthly buckets (12) ---------------------------------------------
  const monthly: DashboardPoint[] = [];
  const monthlyIndex = new Map<string, DashboardPoint>();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const point: DashboardPoint = {
      label: `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      bookings: 0,
      revenueUsdCents: 0,
    };
    monthly.push(point);
    monthlyIndex.set(key, point);
  }

  // ----- daily buckets (30) ------------------------------------------------
  const daily: { label: string; bookings: number }[] = [];
  const dailyIndex = new Map<string, { label: string; bookings: number }>();
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const point = { label: `${d.getDate()}/${d.getMonth() + 1}`, bookings: 0 };
    daily.push(point);
    dailyIndex.set(key, point);
  }

  const statusCounts: Record<AdminBookingStatus, number> = {
    awaiting_payment: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
  };

  const lineMap = new Map<string, DashboardBucket>();
  const productMap = new Map<string, DashboardBucket>();

  let kpiBookings = 0;
  let kpiRevenue = 0;
  let kpiCompletedRevenue = 0;
  let kpiCancelled = 0;
  let kpiPayingCount = 0;

  for (const booking of bookings) {
    const created = new Date(booking.createdAt);
    const paysRevenue = REVENUE_STATUSES.has(booking.status);

    kpiBookings += 1;
    if (isBookingStatus(booking.status)) statusCounts[booking.status] += 1;
    if (booking.status === "cancelled") kpiCancelled += 1;
    if (paysRevenue) {
      kpiRevenue += booking.totalUsdCents;
      kpiPayingCount += 1;
      if (booking.status === "completed") kpiCompletedRevenue += booking.totalUsdCents;
    }

    const mKey = `${created.getFullYear()}-${created.getMonth()}`;
    const monthPoint = monthlyIndex.get(mKey);
    if (monthPoint) {
      monthPoint.bookings += 1;
      if (paysRevenue) monthPoint.revenueUsdCents += booking.totalUsdCents;
    }

    if (created >= daySince) {
      const dKey = `${created.getFullYear()}-${created.getMonth()}-${created.getDate()}`;
      const dayPoint = dailyIndex.get(dKey);
      if (dayPoint) dayPoint.bookings += 1;
    }

    // Line + product breakdowns — driven by the booking's items.
    const firstLineId = booking.items.find((i) => i.product?.lineId)?.product?.lineId;
    if (firstLineId) {
      const label = lineLabel.get(firstLineId) ?? "Lainnya";
      const bucket = lineMap.get(label) ?? { label, bookings: 0, revenueUsdCents: 0 };
      bucket.bookings += 1;
      if (paysRevenue) bucket.revenueUsdCents += booking.totalUsdCents;
      lineMap.set(label, bucket);
    }

    for (const item of booking.items) {
      const label = item.product?.title ?? item.label;
      const bucket = productMap.get(label) ?? { label, bookings: 0, revenueUsdCents: 0 };
      bucket.bookings += 1;
      if (paysRevenue) bucket.revenueUsdCents += item.totalUsdCents;
      productMap.set(label, bucket);
    }
  }

  const lineBreakdown = [...lineMap.values()].sort((a, b) => b.bookings - a.bookings);
  const topProducts = [...productMap.values()]
    .sort((a, b) => b.bookings - a.bookings || b.revenueUsdCents - a.revenueUsdCents)
    .slice(0, 5);

  return {
    monthly,
    daily,
    statusCounts,
    lineBreakdown,
    topProducts,
    kpi: {
      bookings: kpiBookings,
      revenueUsdCents: kpiRevenue,
      completedRevenueUsdCents: kpiCompletedRevenue,
      avgUsdCents: kpiPayingCount > 0 ? Math.round(kpiRevenue / kpiPayingCount) : 0,
      cancelled: kpiCancelled,
    },
  };
}

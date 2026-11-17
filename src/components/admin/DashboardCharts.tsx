"use client";

import { useCallback } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { getAdminDashboardData } from "@/app/actions/admin-dashboard";
import type { AdminDashboardData } from "@/types/admin";
import { adminClass } from "./tokens";
import { useAdminValue } from "./useAdminList";

/**
 * The dashboard analytics — ApexCharts over the real booking data.
 *
 * `react-apexcharts` needs the browser (it renders SVG through the DOM), so
 * the wrapper is loaded with `ssr: false`, same pattern as the Leaflet maps.
 */
const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const PALETTE = ["#111827", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const BASE_OPTIONS: ApexOptions = {
  chart: {
    fontFamily: "inherit",
    toolbar: { show: false },
    animations: { enabled: true, easing: "easeout", speed: 400 },
  },
  colors: PALETTE,
  dataLabels: { enabled: false },
  grid: { borderColor: "#e5e7eb", strokeDashArray: 4 },
  tooltip: { theme: "light" },
};

function moneyTooltip(value: number): string {
  return usd.format(value / 100);
}

/** One chart panel — title, optional hint, and the chart body. */
function ChartPanel({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`${adminClass.panel} px-4 py-4 ${className ?? ""}`}>
      <h3 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h3>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--admin-muted)]">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${adminClass.panel} px-4 py-4`}>
      <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--admin-muted)]">
        {label}
      </span>
      <span className="mt-1.5 block text-[22px] font-semibold tabular-nums tracking-[-0.02em]">
        {value}
      </span>
      {hint ? <span className="mt-0.5 block text-[11px] text-[var(--admin-muted)]">{hint}</span> : null}
    </div>
  );
}

export default function DashboardCharts() {
  const load = useCallback(() => getAdminDashboardData(), []);
  const { data, loading, error } = useAdminValue<AdminDashboardData>(load);

  if (loading) {
    return <p className="mt-6 text-[13px] text-[var(--admin-muted)]">Memuat chart…</p>;
  }
  if (error) {
    return <p className={`${adminClass.panel} mt-6 px-3 py-2 text-[12px] text-danger`}>{error}</p>;
  }
  if (!data) return null;

  // --- revenue per month (area) ---
  const revenueOptions: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "area" },
    stroke: { curve: "smooth", width: 2 },
    fill: { type: "gradient", gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
    xaxis: { categories: data.monthly.map((m) => m.label) },
    yaxis: { labels: { formatter: (v: number) => usd.format(v / 100) } },
    tooltip: { y: { formatter: (v: number) => moneyTooltip(v) } },
  };
  const revenueSeries = [
    { name: "Revenue", data: data.monthly.map((m) => m.revenueUsdCents) },
  ];

  // --- bookings per month (column) ---
  const bookingsOptions: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "bar" },
    plotOptions: { bar: { borderRadius: 3, columnWidth: "55%" } },
    xaxis: { categories: data.monthly.map((m) => m.label) },
  };
  const bookingsSeries = [
    { name: "Booking", data: data.monthly.map((m) => m.bookings) },
  ];

  // --- last 30 days (line) ---
  const dailyOptions: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "line" },
    stroke: { curve: "smooth", width: 2 },
    markers: { size: 0 },
    xaxis: { categories: data.daily.map((d) => d.label), tickAmount: 10 },
  };
  const dailySeries = [{ name: "Booking", data: data.daily.map((d) => d.bookings) }];

  // --- status donut ---
  const statusLabels: Record<keyof AdminDashboardData["statusCounts"], string> = {
    awaiting_payment: "Menunggu Pembayaran",
    confirmed: "Dikonfirmasi",
    completed: "Selesai",
    cancelled: "Dibatalkan",
  };
  const statusKeys = Object.keys(data.statusCounts) as (keyof AdminDashboardData["statusCounts"])[];
  const donutOptions: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "donut" },
    labels: statusKeys.map((k) => statusLabels[k]),
    colors: ["#f59e0b", "#0ea5e9", "#10b981", "#9ca3af"],
    legend: { position: "bottom", fontSize: "11px" },
    stroke: { colors: ["#fff"] },
  };
  const donutSeries = statusKeys.map((k) => data.statusCounts[k]);

  // --- revenue per service line (horizontal bar) ---
  const lineOptions: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "bar" },
    plotOptions: { bar: { borderRadius: 3, horizontal: true, barHeight: "60%" } },
    xaxis: { categories: data.lineBreakdown.map((l) => l.label) },
    tooltip: { y: { formatter: (v: number) => moneyTooltip(v) } },
    dataLabels: { enabled: false },
  };
  const lineSeries = [
    { name: "Revenue", data: data.lineBreakdown.map((l) => l.revenueUsdCents) },
  ];

  // --- top products (horizontal bar, bookings) ---
  const productOptions: ApexOptions = {
    ...BASE_OPTIONS,
    chart: { ...BASE_OPTIONS.chart, type: "bar" },
    colors: ["#0ea5e9"],
    plotOptions: { bar: { borderRadius: 3, horizontal: true, barHeight: "60%" } },
    xaxis: {
      categories: data.topProducts.map((p) =>
        p.label.length > 28 ? `${p.label.slice(0, 28)}…` : p.label,
      ),
      labels: { style: { fontSize: "10px" } },
    },
    yaxis: { labels: { style: { fontSize: "10px" } } },
  };
  const productSeries = [
    { name: "Booking", data: data.topProducts.map((p) => p.bookings) },
  ];

  return (
    <div className="mt-8">
      <h3 className={adminClass.label}>Analitik Transaksi — 12 bulan terakhir</h3>

      {/* KPI cards */}
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Booking" value={String(data.kpi.bookings)} hint="12 bulan terakhir" />
        <KpiCard label="Revenue" value={usd.format(data.kpi.revenueUsdCents / 100)} hint="selesai + dikonfirmasi" />
        <KpiCard
          label="Revenue Selesai"
          value={usd.format(data.kpi.completedRevenueUsdCents / 100)}
          hint="booking completed"
        />
        <KpiCard label="Rata-rata / Booking" value={usd.format(data.kpi.avgUsdCents / 100)} />
        <KpiCard label="Dibatalkan" value={String(data.kpi.cancelled)} />
      </div>

      {/* Charts */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartPanel title="Revenue per Bulan" hint="Booking selesai + dikonfirmasi (USD)">
          <Chart type="area" options={revenueOptions} series={revenueSeries} height={260} />
        </ChartPanel>
        <ChartPanel title="Jumlah Booking per Bulan">
          <Chart type="bar" options={bookingsOptions} series={bookingsSeries} height={260} />
        </ChartPanel>
        <ChartPanel title="Status Booking" hint="Distribusi 12 bulan terakhir">
          <Chart type="donut" options={donutOptions} series={donutSeries} height={260} />
        </ChartPanel>
        <ChartPanel title="Booking 30 Hari Terakhir">
          <Chart type="line" options={dailyOptions} series={dailySeries} height={260} />
        </ChartPanel>
        <ChartPanel title="Revenue per Service Line" hint="Berdasarkan produk item pertama booking">
          <Chart type="bar" options={lineOptions} series={lineSeries} height={280} />
        </ChartPanel>
        <ChartPanel title="Top 5 Produk" hint="Jumlah booking per produk">
          <Chart type="bar" options={productOptions} series={productSeries} height={280} />
        </ChartPanel>
      </div>
    </div>
  );
}

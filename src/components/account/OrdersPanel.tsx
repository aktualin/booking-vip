"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AccountPageHeader from "@/components/account/AccountPageHeader";
import { useLocale } from "@/components/providers/LocaleProvider";
import {
  listMyOrders,
  type MyOrderDTO,
} from "@/app/actions/account";
import {
  listMyEvoaOrders,
  type EvoaOrderSummaryDTO,
} from "@/app/actions/evoa-tracking";
import { EVOA_STATUS_LABELS } from "@/lib/evoa-shared";

/**
 * The order history.
 *
 * A table of the bookings (the e-VOA applications get their own table
 * below) and a link to the downloadable invoice of every order.
 */
export default function OrdersPanel() {
  const { lang, t } = useLocale();
  const dateLocale = lang === "id" ? "id-ID" : "en-US";

  const [orders, setOrders] = useState<MyOrderDTO[]>([]);
  const [evoaOrders, setEvoaOrders] = useState<EvoaOrderSummaryDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [orderRows, visaRows] = await Promise.all([
        listMyOrders(),
        listMyEvoaOrders(),
      ]);
      setOrders(orderRows);
      setEvoaOrders(visaRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <AccountPageHeader
        title={t("orders.title")}
        description={t("orders.subtitle")}
      />

      {/* Orders table */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {t("orders.historyTitle")}
          </h2>
        </div>

        {loading ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">{t("orders.loading")}</p>
        ) : orders.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            {t("orders.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-canvas/60">
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.code")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.date")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.service")}
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.total")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.status")}
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.action")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-canvas/40">
                    <td className="px-5 py-3.5">
                      <p className="font-mono text-[12px] font-semibold text-ink">
                        {order.code}
                      </p>
                      {order.invoiceNumber ? (
                        <p className="mt-0.5 font-mono text-[11px] text-muted">
                          {order.invoiceNumber}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-muted">
                      {new Date(order.serviceAt).toLocaleDateString(dateLocale, {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-ink">{order.itemLabel}</td>
                    <td className="px-5 py-3.5 text-right text-[13px] font-semibold text-ink">
                      ${(order.totalUsdCents / 100).toFixed(2)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex rounded-full bg-canvas px-2.5 py-0.5 text-[11px] font-medium text-muted">
                        {order.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/account/orders/${encodeURIComponent(order.code)}`}
                          className="text-[12px] font-semibold text-brand transition-opacity hover:opacity-80"
                        >
                          {t("orders.track")}
                        </Link>
                        <Link
                          href={`/account/orders/${encodeURIComponent(order.code)}/invoice`}
                          className="text-[12px] font-semibold text-muted transition-colors hover:text-ink"
                        >
                          {t("orders.downloadInvoice")}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Visa applications */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {t("orders.evoaTitle")}
          </h2>
        </div>

        {loading ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">{t("orders.loading")}</p>
        ) : evoaOrders.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            {t("orders.evoaEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-canvas/60">
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.number")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.applicant")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.arrival")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.status")}
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {t("orders.col.action")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {evoaOrders.map((application) => (
                  <tr key={application.id} className="transition-colors hover:bg-canvas/40">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/account/visa/${encodeURIComponent(application.code)}`}
                        className="font-mono text-[12px] font-semibold text-brand transition-opacity hover:opacity-80"
                      >
                        {application.code}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-[13px] text-ink">{application.primaryName}</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {t("orders.applicantCount", { n: application.applicantCount })}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-muted">
                      {new Date(application.arrivalDate).toLocaleDateString(dateLocale, {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex rounded-full bg-canvas px-2.5 py-0.5 text-[11px] font-medium text-muted">
                        {EVOA_STATUS_LABELS[application.status]?.[lang] ?? application.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/account/visa/${encodeURIComponent(application.code)}`}
                        className="text-[12px] font-semibold text-brand transition-opacity hover:opacity-80"
                      >
                        {t("orders.track")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

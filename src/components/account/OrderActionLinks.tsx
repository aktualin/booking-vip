"use client";

// The order-detail entry points that depend on the order state: the
// checkout retry of an unpaid order and the signed rental agreement of a
// transport order.

import Link from "next/link";
import { useLocale } from "@/components/providers/LocaleProvider";

export default function OrderActionLinks({
  code,
  showPay,
  showAgreement,
}: {
  code: string;
  showPay: boolean;
  showAgreement: boolean;
}) {
  const { t } = useLocale();

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {showPay ? (
        <Link
          href={`/pay/${encodeURIComponent(code)}`}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          {t("payment.payNow")}
        </Link>
      ) : null}
      {showAgreement ? (
        <Link
          href={`/account/orders/${encodeURIComponent(code)}/agreement`}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
        >
          {t("agreement.title")}
        </Link>
      ) : null}
    </div>
  );
}

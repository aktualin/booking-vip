"use client";

// The wizard's PAYMENT step — promo/voucher plus the shared checkout form
// (gateway methods AND the signed-in customer's saved cards, CVV only).
// "Bayar Sekarang" creates the booking (once) and dispatches the picked
// intent; the yellow PayPal button is the express path for PAYPAL (PayPal
// never appears as a picker radio).

import { useEffect, useState } from "react";
import { validatePromoCode } from "@/app/actions/booking";
import { listMyVouchers, type VoucherDTO } from "@/app/actions/loyalty";
import { useAccountOverview } from "@/components/providers/AccountProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import PaymentForm, { type PayIntent } from "@/components/payment/PaymentForm";

/** The promo/voucher currently applied to the booking (validated server-side). */
export type AppliedPromo = {
  code: string;
  title: string;
  discountUsdCents: number;
};

type Props = {
  /**
   * Pay: the wizard creates the booking (once) and dispatches the intent —
   * a gateway method (hosted checkout) or a saved card (token charge).
   */
  onSubmit: (intent: PayIntent) => void;
  onBack: () => void;
  isSubmitting: boolean;
  error: string | null;
  /** The subtotal in USD cents — the promo is checked against it. */
  subtotalUsdCents: number;
  /** The server-computed tax (USD cents) of the discounted subtotal. */
  taxUsdCents?: number;
  /** The applied promo lives in the wizard so the summary can show it too. */
  appliedPromo: AppliedPromo | null;
  onPromoChange: (promo: AppliedPromo | null) => void;
};

export default function StepPayment({
  onSubmit,
  onBack,
  isSubmitting,
  error,
  subtotalUsdCents,
  taxUsdCents = 0,
  appliedPromo,
  onPromoChange,
}: Props) {
  const { t, formatMoney } = useLocale();
  const { overview } = useAccountOverview();

  const [promoInput, setPromoInput] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // The signed-in customer's unused reward vouchers — one click applies one.
  const [vouchers, setVouchers] = useState<VoucherDTO[]>([]);

  useEffect(() => {
    if (!overview) {
      setVouchers([]);
      return;
    }
    listMyVouchers().then((rows) =>
      setVouchers(
        rows.filter(
          (v) =>
            !v.used &&
            (v.endsAt == null || new Date(v.endsAt).getTime() > Date.now()),
        ),
      ),
    );
  }, [overview]);

  /** Check a code server-side — the discount only applies once it is valid. */
  const checkCode = async (code: string) => {
    if (!code) {
      onPromoChange(null);
      setPromoError(t("loyalty.promoEmpty"));
      return;
    }

    setChecking(true);
    setPromoError(null);

    const result = await validatePromoCode(code, subtotalUsdCents);
    setChecking(false);

    if (!result.ok) {
      onPromoChange(null);
      setPromoError(result.error);
      return;
    }

    onPromoChange({
      code: result.code,
      title: result.title,
      discountUsdCents: result.discountUsdCents,
    });
  };

  const handleCheckPromo = () => void checkCode(promoInput.trim());

  const handleApplyVoucher = (code: string) => {
    setPromoInput(code);
    void checkCode(code);
  };

  // Points this booking will earn once paid (1 point per whole dollar of
  // the tax-inclusive discounted total — the same rule the server applies).
  const earnPreview = Math.max(
    0,
    Math.floor(
      (subtotalUsdCents - (appliedPromo?.discountUsdCents ?? 0) + taxUsdCents) / 100,
    ),
  );

  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-ink">{t("wizard.payment.title")}</h2>

      {error && (
        <div className="mb-4 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Reward vouchers of the signed-in customer */}
      {vouchers.length > 0 ? (
        <div className="mb-6 rounded-2xl border border-line bg-white p-5">
          <h3 className="mb-3 text-base font-bold text-ink">
            {t("loyalty.vouchersTitle")}
          </h3>
          <div className="space-y-2">
            {vouchers.map((voucher) => {
              const active = appliedPromo?.code === voucher.code;
              return (
                <div
                  key={voucher.code}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
                    active ? "border-brand bg-brand-soft/40" : "border-line"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] font-bold text-ink">
                      {voucher.code}
                    </p>
                    <p className="truncate text-[12px] text-muted">
                      {voucher.title}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyVoucher(voucher.code)}
                    disabled={checking || isSubmitting || active}
                    className="h-9 shrink-0 rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {active ? t("loyalty.voucherApplied") : t("loyalty.voucherApply")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Promo code */}
      <div className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h3 className="mb-3 text-base font-bold text-ink">{t("loyalty.promoTitle")}</h3>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
            placeholder={t("loyalty.promoPlaceholder")}
            className="h-11 flex-1 rounded-xl border border-line bg-white px-4 text-sm text-ink outline-none placeholder:text-muted focus:border-brand"
          />
          <button
            type="button"
            onClick={handleCheckPromo}
            disabled={checking || isSubmitting}
            className="h-11 rounded-xl border border-line bg-white px-5 text-sm font-semibold text-ink transition-colors hover:bg-canvas disabled:opacity-50"
          >
            {checking ? t("loyalty.promoChecking") : t("loyalty.promoCheck")}
          </button>
        </div>

        {promoError ? (
          <p className="mt-2 text-[13px] text-danger">{promoError}</p>
        ) : null}

        {appliedPromo ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-brand-soft px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-brand-dark">
                {t("loyalty.promoApplied", { code: appliedPromo.code })}
              </p>
              <p className="truncate text-[12px] text-brand-dark/70">
                {appliedPromo.title}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[13px] font-bold text-brand-dark">
                −{formatMoney(appliedPromo.discountUsdCents / 100)}
              </span>
              <button
                type="button"
                onClick={() => {
                  onPromoChange(null);
                  setPromoInput("");
                  setPromoError(null);
                }}
                aria-label={t("loyalty.promoRemove")}
                className="flex h-6 w-6 items-center justify-center rounded-full text-brand-dark/70 transition-colors hover:bg-white/60 hover:text-brand-dark"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        {overview ? (
          <p className="mt-3 text-[12px] font-medium text-brand-dark">
            {t("loyalty.earnPreview", { n: earnPreview.toLocaleString("id-ID") })}
          </p>
        ) : null}
      </div>

      {/* The checkout form — methods, saved cards, PayPal express, Pay now. */}
      <PaymentForm
        showHeader={false}
        onPay={onSubmit}
        onBack={onBack}
        backLabel={t("wizard.payment.back")}
        isSubmitting={isSubmitting}
        payLabel={"Bayar Sekarang"}
      />
    </div>
  );
}

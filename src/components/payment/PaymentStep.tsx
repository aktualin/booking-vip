"use client";

// The payment screen of a created booking (transport / tour result screens
// and any retry): picking a method — or one of the signed-in customer's
// saved cards, CVV only — and paying is all that is left. Gateway methods
// redirect to the hosted checkout; saved cards run the server-side token
// charge. Failures surface as the checkout banner on `/pay/[code]`.

import { useState } from "react";
import { useLocale } from "@/components/providers/LocaleProvider";
import { showToast } from "@/components/ui/toast";
import PaymentForm, { type PayIntent } from "./PaymentForm";
import { dispatchPayIntent } from "./dispatch";

export default function PaymentStep({
  bookingCode,
  email,
  amountUsdCents,
  onBack,
  banner = null,
}: {
  bookingCode: string;
  email: string;
  /** The total in USD cents — shown next to the form head. */
  amountUsdCents: number;
  onBack?: () => void;
  /** The red banner of a failed / expired attempt. */
  banner?: "failed" | "expired" | null;
}) {
  const { formatMoney } = useLocale();
  const [submitting, setSubmitting] = useState(false);

  const pay = async (intent: PayIntent) => {
    if (submitting) return;
    setSubmitting(true);
    const result = await dispatchPayIntent(intent, { bookingCode, email });
    if (!result.ok) {
      showToast(result.error, "error");
      setSubmitting(false);
      return;
    }
    window.location.assign(result.redirectUrl);
  };

  return (
    <div>
      <p className="mb-3 text-right text-[13px] text-muted">
        Total{" "}
        <span className="font-bold text-ink">
          {formatMoney(amountUsdCents / 100)}
        </span>
      </p>
      <PaymentForm
        onPay={pay}
        onBack={onBack}
        isSubmitting={submitting}
        banner={banner}
      />
    </div>
  );
}

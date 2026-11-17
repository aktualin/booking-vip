"use client";

// The payment screen of the transport booking flow (/transport/booking):
// the booking already exists, so picking a method and paying is all that is
// left. Paying redirects to the Xendit hosted checkout page, where the card
// form lives.

import { useEffect, useState } from "react";
import { getPaymentMethods } from "@/app/actions/catalog";
import { startBookingPayment } from "@/app/actions/payments";
import { useLocale } from "@/components/providers/LocaleProvider";
import PaymentMethodPicker, {
  type PaymentMethodOption,
} from "./PaymentMethodPicker";

export default function PaymentStep({
  bookingCode,
  email,
  amountUsdCents,
  onBack,
}: {
  bookingCode: string;
  email: string;
  /** The total in USD cents — shown next to the methods. */
  amountUsdCents: number;
  onBack?: () => void;
}) {
  const { formatMoney, t } = useLocale();

  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPaymentMethods().then((list) => {
      setMethods(list);
      setLoaded(true);
      if (list.length > 0) setSelected(list[0].code);
    });
  }, []);

  /** Remember the booking so the return page can find the email again. */
  const rememberBooking = () => {
    try {
      localStorage.setItem(
        "booking-vip:last-booking",
        JSON.stringify({ code: bookingCode, email }),
      );
    } catch {
      // Storage unavailable — the return page asks for the email.
    }
  };

  const pay = async () => {
    if (!selected || submitting) return;

    // Credit card → the Xendit hosted checkout; the customer comes back via
    // /payment/return, which polls the payment status.
    setSubmitting(true);
    setError(null);
    const result = await startBookingPayment({
      bookingCode,
      email,
      methodCode: selected,
    });
    if (result.ok) {
      rememberBooking();
      window.location.assign(result.checkoutUrl);
      return;
    }
    setError(result.error);
    setSubmitting(false);
  };

  return (
    <div className="rounded-2xl border border-line bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-bold tracking-[-0.01em] text-ink">
          {t("wizard.payment.selectMethod")}
        </h2>
        <p className="text-[13px] text-muted">
          Total{" "}
          <span className="font-bold text-ink">
            {formatMoney(amountUsdCents / 100)}
          </span>
        </p>
      </div>

      {!loaded ? (
        <p className="mt-4 text-[13px] text-muted">Memuat metode pembayaran…</p>
      ) : methods.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">
          Belum ada metode pembayaran yang tersedia. Silakan hubungi customer
          service kami.
        </p>
      ) : (
        <div className="mt-4">
          <PaymentMethodPicker
            methods={methods}
            selected={selected}
            onSelect={setSelected}
            disabled={submitting}
          />
        </div>
      )}

      {error ? (
        <p className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
          >
            Kembali
          </button>
        ) : null}
        <button
          type="button"
          onClick={pay}
          disabled={!selected || submitting || !loaded}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-8 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Memproses…" : "Lanjut ke pembayaran"}
        </button>
      </div>
    </div>
  );
}
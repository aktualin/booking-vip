"use client";

// The PayPal-branded express pay button — the classic yellow button with the
// PayPal monogram. Every checkout surface renders it next to its primary
// (card/Xendit) CTA: clicking starts a PAYPAL payment through the shared
// startBookingPayment action and the parent navigates to the returned
// checkout URL. The parent owns the flow; this button owns only the branding
// and its own pending state while `onPay` is in flight.

import { useState } from "react";
import { PayPalLogo } from "@/components/icons";

export default function PayPalPayButton({
  onPay,
  disabled,
  busy,
  label,
  processingLabel,
  className,
}: {
  /**
   * Starts the payment. Awaited — on success the parent navigates away (the
   * pending state simply persists until the page unloads); on error the
   * parent surfaces the message and the button re-enables.
   */
  onPay: () => void | Promise<void>;
  /** Hard disable (e.g. the method list is still loading). */
  disabled?: boolean;
  /** Another submit on the same screen is already in flight. */
  busy?: boolean;
  /** Defaults to "Bayar dengan PayPal". */
  label?: string;
  /** Defaults to "Memproses…". */
  processingLabel?: string;
  className?: string;
}) {
  const [starting, setStarting] = useState(false);
  const pending = starting || Boolean(busy);

  const click = async () => {
    if (pending || disabled) return;
    setStarting(true);
    try {
      await onPay();
    } finally {
      setStarting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void click()}
      disabled={disabled || pending}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#FFC439] px-6 text-[13px] font-bold text-[#003087] shadow-sm transition-colors hover:bg-[#f5b921] disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
    >
      <PayPalLogo width={15} height={18} />
      {pending ? (processingLabel ?? "Memproses…") : (label ?? "Bayar dengan PayPal")}
    </button>
  );
}

"use client";

// The payment method picker — one radio card per active method: Kartu
// Kredit/Debit (Xendit) and PayPal. Shared by the booking wizard's payment
// step and the transport flow's payment screen. Every method redirects to
// its gateway's hosted checkout page.

import { PaymentBrandIcon } from "@/components/icons";

export type PaymentMethodOption = {
  code: string;
  label: string;
};

/** Display copy per method — anything unknown falls back to its DTO label. */
const METHOD_META: Record<string, { title: string; hint: string }> = {
  CREDIT_CARD: {
    title: "Kartu Kredit / Debit",
    hint: "Visa, Mastercard, JCB & Amex — bayar aman lewat halaman checkout Xendit.",
  },
  PAYPAL: {
    title: "PayPal",
    hint: "Bayar pakai akun PayPal — saldo atau kartu yang tersimpan di sana, dalam USD.",
  },
};

export default function PaymentMethodPicker({
  methods,
  selected,
  onSelect,
  disabled,
}: {
  methods: PaymentMethodOption[];
  selected: string;
  onSelect: (code: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Metode pembayaran">
      {methods.map((method) => {
        const meta = METHOD_META[method.code];
        const active = selected === method.code;
        return (
          <button
            key={method.code}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(method.code)}
            className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? "border-brand bg-brand-soft"
                : "border-line bg-white hover:bg-canvas"
            }`}
          >
            <span className="flex h-10 min-w-16 shrink-0 items-center justify-center gap-1 rounded-lg border border-line bg-white px-1.5">
              {method.code === "CREDIT_CARD" ? (
                <>
                  <PaymentBrandIcon brand="visa" height={16} />
                  <PaymentBrandIcon brand="mastercard" height={16} />
                  <PaymentBrandIcon brand="jcb" height={16} />
                  <PaymentBrandIcon brand="amex" height={16} />
                </>
              ) : method.code === "PAYPAL" ? (
                <PaymentBrandIcon brand="paypal" height={16} />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-ink">
                {meta?.title ?? method.label}
              </span>
              {meta?.hint ? (
                <span className="mt-0.5 block text-[12px] text-muted">
                  {meta.hint}
                </span>
              ) : null}
            </span>
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                active ? "border-brand" : "border-line"
              }`}
            >
              {active ? <span className="h-2.5 w-2.5 rounded-full bg-brand" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
"use client";

// The payment method picker — one radio row per active method inside a
// single grouped box (checkout style): the radio on the left, the accepted
// card brands on the right. PayPal is NOT a radio here — it is the yellow
// express button rendered next to the primary CTA. Every method redirects to
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
  QRIS: {
    title: "QRIS",
    hint: "Scan pakai aplikasi apa pun — e-wallet & mobile banking, langsung di halaman checkout.",
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
    <div
      className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white"
      role="radiogroup"
      aria-label="Metode pembayaran"
    >
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
            className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              active ? "bg-brand-soft/50" : "bg-white hover:bg-canvas"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                active ? "border-brand" : "border-line"
              }`}
            >
              {active ? <span className="h-2.5 w-2.5 rounded-full bg-brand" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink">
                {meta?.title ?? method.label}
              </span>
              {meta?.hint ? (
                <span className="mt-0.5 block text-[12px] text-muted">{meta.hint}</span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {method.code === "CREDIT_CARD" ? (
                <>
                  <PaymentBrandIcon brand="visa" height={16} />
                  <PaymentBrandIcon brand="mastercard" height={16} />
                  <PaymentBrandIcon brand="amex" height={16} />
                </>
              ) : method.code === "QRIS" ? (
                <PaymentBrandIcon brand="qris" height={18} />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

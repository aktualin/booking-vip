"use client";

// The embedded credit-card FIELDS — Host-to-Host.
//
// A fully controlled presentational component: the parent owns the values
// and the submit button. On submit the parent's server action starts the
// DOKU 3DS authentication and the browser redirects to the issuer's page —
// the only redirect, and it is the issuer's own OTP. Card data lives in the
// parent's state only: it is sent to our server exactly once and cleared.

import { CreditCard, Lock } from "lucide-react";

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand disabled:opacity-60";

/** The card form values, as typed (formatted). */
export type CardFields = {
  cardNumber: string; // "4617 0069 1111 1106"
  expiry: string; // "01/31"
  cvv: string; // "123"
};

export const EMPTY_CARD_FIELDS: CardFields = { cardNumber: "", expiry: "", cvv: "" };

/** Parse the typed fields into the DOKU request shape (or a user error). */
export function parseCardFields(
  v: CardFields,
): { ok: true; cardNumber: string; cardExpiry: string; cardCvv: string } | { ok: false; error: string } {
  const digits = v.cardNumber.replace(/\s/g, "");
  const expiryDigits = v.expiry.replace("/", "");
  const cvv = v.cvv.trim();
  if (digits.length < 13 || digits.length > 19) {
    return { ok: false, error: "Nomor kartu belum lengkap." };
  }
  if (!/^[0-9]{4}$/.test(expiryDigits)) {
    return { ok: false, error: "Masa berlaku kartu belum lengkap." };
  }
  const month = Number(expiryDigits.slice(0, 2));
  if (month < 1 || month > 12) {
    return { ok: false, error: "Bulan masa berlaku tidak valid." };
  }
  if (cvv.length < 3 || cvv.length > 4) {
    return { ok: false, error: "CVV belum lengkap." };
  }
  return { ok: true, cardNumber: digits, cardExpiry: expiryDigits, cardCvv: cvv };
}

type Props = {
  value: CardFields;
  onChange: (v: CardFields) => void;
  /** The total shown on the amount strip (display only — the server charges). */
  amountUsdCents: number;
  formatMoney: (usd: number) => string;
  disabled?: boolean;
  /** Validation error from the parent, shown inline. */
  error?: string | null;
};

/** 4-digit groups, max 19 digits. */
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

/** MMYY → "MM/YY" while typing. */
function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export default function DokuCardForm({
  value,
  onChange,
  amountUsdCents,
  formatMoney,
  disabled,
  error,
}: Props) {
  return (
    <div className="space-y-4">
      {/* Amount strip */}
      <div className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
        <span className="text-[13px] font-medium text-muted">Total tagihan</span>
        <span className="text-[16px] font-bold text-ink">
          {formatMoney(amountUsdCents / 100)}
        </span>
      </div>

      {/* Card number */}
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink">
          Nomor kartu
        </span>
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            value={value.cardNumber}
            onChange={(e) => onChange({ ...value, cardNumber: formatCardNumber(e.target.value) })}
            placeholder="4111 1111 1111 1111"
            disabled={disabled}
            className={`${INPUT_CLASS} pl-10`}
          />
          <CreditCard
            width={16}
            height={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
        </div>
      </label>

      {/* Expiry + CVV */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink">
            Masa berlaku
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-exp"
            value={value.expiry}
            onChange={(e) => onChange({ ...value, expiry: formatExpiry(e.target.value) })}
            placeholder="MM/YY"
            disabled={disabled}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink">
            CVV
          </span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="cc-csc"
            value={value.cvv}
            onChange={(e) => onChange({ ...value, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })}
            placeholder="123"
            disabled={disabled}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      {error ? (
        <p
          aria-live="polite"
          className="rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-[12px] text-danger"
        >
          {error}
        </p>
      ) : null}

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
        <Lock width={11} height={11} aria-hidden="true" />
        Data kartu dienkripsi &amp; diproses oleh DOKU. Anda akan diarahkan ke
        halaman verifikasi 3D Secure bank penerbit.
      </p>

      <div className="flex items-center justify-center gap-2 pt-1">
        <span className="rounded border border-line px-2 py-0.5 text-[10px] font-bold text-muted">VISA</span>
        <span className="rounded border border-line px-2 py-0.5 text-[10px] font-bold text-muted">Mastercard</span>
        <span className="rounded border border-line px-2 py-0.5 text-[10px] font-bold text-muted">JCB</span>
      </div>
    </div>
  );
}
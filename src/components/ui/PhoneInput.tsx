"use client";

import { useId } from "react";
import { COUNTRIES } from "@/data/countries";
import { flagEmoji } from "@/lib/flag";

/**
 * A phone field with a country-code picker: a flag + dial-code `<select>` on
 * the left, the local number on the right. The two pieces are reported back
 * through `onChange`, so it works both for forms that store the country code
 * separately (booking contacts) and for forms that store one international
 * string (register / profile / e-VOA), which join the pieces themselves via
 * `formatInternational`.
 *
 * `inputClassName` is applied to both the select and the text input so each
 * form keeps its own look.
 */
export default function PhoneInput({
  countryCode,
  phone,
  onChange,
  label,
  required,
  errored,
  disabled,
  placeholder,
  className = "",
  inputClassName = DEFAULT_INPUT_CLASS,
  selectClassName,
  name,
  id,
  autoComplete = "tel-national",
}: {
  /** ISO alpha-2 code, e.g. "ID". Defaults to Indonesia when unknown. */
  countryCode: string;
  /** The local number, without the dial prefix. */
  phone: string;
  onChange: (next: { countryCode: string; phone: string }) => void;
  label?: string;
  required?: boolean;
  errored?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Tailwind classes on the outer wrapper. */
  className?: string;
  /** Classes for both the select and the input. */
  inputClassName?: string;
  /** Extra classes just for the select (e.g. a fixed width). */
  selectClassName?: string;
  /** `name` attribute on the local-number input (for plain form posts). */
  name?: string;
  id?: string;
  autoComplete?: string;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  const code = countryCode?.trim().toUpperCase() || "ID";
  const dial = COUNTRIES.find((c) => c.code === code)?.dialCode ?? "+62";
  const flag = flagEmoji(code);

  const base = `${inputClassName} ${errored ? "border-danger focus:border-danger" : ""}`.trim();
  const selectClass = `${base} appearance-none pl-2 pr-6 ${selectClassName ?? ""}`.trim();

  return (
    <div className={className}>
      {label ? (
        <label
          htmlFor={fieldId}
          className={`mb-1.5 block text-[12px] font-medium ${errored ? "text-danger" : "text-ink"}`}
        >
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      <div className="grid grid-cols-[112px_1fr] gap-2">
        <div className="relative">
          <select
            aria-label={label ? `${label} — kode negara` : "Kode negara"}
            value={code}
            disabled={disabled}
            onChange={(e) => onChange({ countryCode: e.target.value, phone })}
            className={selectClass}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {flagEmoji(c.code)} {c.dialCode}
              </option>
            ))}
          </select>
          {/* Chevron — the select has `appearance-none`, so we draw our own. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted"
          >
            ▾
          </span>
        </div>
        <input
          id={fieldId}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          value={phone}
          disabled={disabled}
          required={required}
          placeholder={placeholder ?? `${dial} …`}
          onChange={(e) => onChange({ countryCode: code, phone: e.target.value })}
          className={base}
        />
      </div>
    </div>
  );
}

const DEFAULT_INPUT_CLASS =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

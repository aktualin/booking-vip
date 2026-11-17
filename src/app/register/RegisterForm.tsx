"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { registerUser, type UserAuthState } from "@/app/actions/user-auth";
import AuthField from "@/components/auth/AuthField";
import PhoneInput from "@/components/ui/PhoneInput";
import GoogleButton from "@/components/auth/GoogleButton";
import { formatInternational } from "@/lib/flag";
import { useLocale } from "@/components/providers/LocaleProvider";

/**
 * Customer registration form.
 *
 * Only customer accounts are created here — an email on the admin allowlist
 * is flagged as an admin account by the server and cannot be used on the
 * customer side.
 */
export default function RegisterForm() {
  const { t } = useLocale();
  const [state, formAction, pending] = useActionState<UserAuthState, FormData>(
    registerUser,
    {},
  );
  const [phoneCountryCode, setPhoneCountryCode] = useState("ID");
  const [phone, setPhone] = useState("");

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t("auth.register.title")}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {t("auth.register.hasAccount")}{" "}
          <Link
            href="/login"
            className="font-medium text-ink underline underline-offset-4 transition-colors hover:text-brand"
          >
            {t("auth.register.loginLink")}
          </Link>
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <AuthField
          label={t("auth.register.nameLabel")}
          name="name"
          autoComplete="name"
          placeholder={t("auth.register.namePlaceholder")}
        />

        <AuthField
          label={t("auth.register.emailLabel")}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("auth.register.emailPlaceholder")}
        />

        <PhoneInput
          label={t("auth.register.phoneLabel")}
          required
          countryCode={phoneCountryCode}
          phone={phone}
          onChange={({ countryCode, phone }) => {
            setPhoneCountryCode(countryCode);
            setPhone(phone);
          }}
          placeholder={t("auth.register.phonePlaceholder")}
          inputClassName="h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        <input
          type="hidden"
          name="phone"
          value={formatInternational(phoneCountryCode, phone)}
        />

        <AuthField
          label={t("auth.register.passwordLabel")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          placeholder={t("auth.register.passwordPlaceholder")}
        />

        <AuthField
          label={t("auth.register.confirmLabel")}
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          placeholder={t("auth.register.confirmPlaceholder")}
        />

        <div className="-mt-1 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
          <input
            type="checkbox"
            name="terms"
            value="1"
            required
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-ink"
          />
          <span>{t("auth.register.termsAgree")}</span>
        </div>

        {state.error ? (
          <p className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-semibold text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending
            ? t("auth.register.submitting")
            : t("auth.register.submit")}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-muted">{t("auth.register.or")}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton label={t("auth.register.google")} className="w-full" />

      <p className="mt-6 text-center text-xs leading-relaxed text-muted">
        {t("auth.register.termsNotice")}
      </p>
    </div>
  );
}

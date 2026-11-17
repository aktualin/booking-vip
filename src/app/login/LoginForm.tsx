"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import {
  signInUser,
  requestPasswordReset,
  type UserAuthState,
} from "@/app/actions/user-auth";
import AuthField from "@/components/auth/AuthField";
import GoogleButton from "@/components/auth/GoogleButton";
import { useLocale } from "@/components/providers/LocaleProvider";

/**
 * Customer login form — two-step: email first, then password.
 *
 * The password path runs entirely on the server (the Firebase API key never
 * reaches the browser). The Google path opens the Firebase popup in the
 * browser and hands the resulting id token to the server, which verifies it
 * before creating the session cookie.
 */
export default function LoginForm() {
  const { t } = useLocale();
  const [state, formAction, pending] = useActionState<UserAuthState, FormData>(
    signInUser,
    {},
  );
  const [resetPending, startReset] = useTransition();
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  // React resets uncontrolled form fields after a server action completes, so
  // the email is kept in state and restored on the next render.
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "password">("email");
  const [emailError, setEmailError] = useState<string | null>(null);

  function handleContinue() {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError(t("auth.login.emailRequired"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError(t("auth.login.emailInvalid"));
      return;
    }
    setEmailError(null);
    setResetError(null);
    setResetMessage(null);
    setStep("password");
  }

  function handleBackToEmail() {
    setStep("email");
    setResetError(null);
    setResetMessage(null);
  }

  function handleForgotPassword() {
    const currentEmail = email.trim();
    if (!currentEmail) {
      setResetError(t("auth.login.forgotPasswordEmpty"));
      return;
    }

    setResetError(null);
    setResetMessage(null);
    startReset(async () => {
      const result = await requestPasswordReset(currentEmail);
      if (result?.error) {
        setResetError(result.error);
      } else {
        setResetMessage(t("auth.login.resetSent"));
      }
    });
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t("auth.login.title")}
        </h1>
        {step === "email" ? (
          <p className="mt-2 text-sm text-muted">
            {t("auth.login.noAccount")}{" "}
            <Link
              href="/register"
              className="font-medium text-ink underline underline-offset-4 transition-colors hover:text-brand"
            >
              {t("auth.login.registerLink")}
            </Link>
          </p>
        ) : null}
      </div>

      {step === "email" ? (
        <div className="flex flex-col gap-4">
          <AuthField
            label={t("auth.login.emailLabel")}
            name="email"
            type="email"
            autoComplete="username"
            placeholder={t("auth.login.emailPlaceholder")}
            value={email}
            onChange={(v) => {
              setEmail(v);
              if (emailError) setEmailError(null);
            }}
          />

          {emailError ? (
            <p className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
              {emailError}
            </p>
          ) : null}

          {state.error ? (
            <p className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
              {state.error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleContinue}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-semibold text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2"
          >
            {t("auth.login.continue")}
          </button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-4">
          {/* Hidden email so the server action still receives it. */}
          <input type="hidden" name="email" value={email} />

          <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5">
            <button
              type="button"
              onClick={handleBackToEmail}
              aria-label={t("auth.login.changeEmailAria")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white hover:text-ink"
            >
              <ArrowLeftIcon />
            </button>
            <span className="truncate text-sm font-medium text-ink">
              {email}
            </span>
          </div>

          <div>
            <AuthField
              label={t("auth.login.passwordLabel")}
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder={t("auth.login.passwordPlaceholder")}
            />
            <div className="mt-2.5 flex items-center justify-between">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted">
                <input
                  type="checkbox"
                  name="remember"
                  value="1"
                  defaultChecked
                  className="h-4 w-4 rounded border-line accent-ink"
                />
                {t("auth.login.rememberMe")}
              </label>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resetPending}
                className="text-[13px] font-medium text-ink underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resetPending
                  ? t("auth.login.forgotPasswordPending")
                  : t("auth.login.forgotPassword")}
              </button>
            </div>
          </div>

          {state.error ? (
            <p className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
              {state.error}
            </p>
          ) : null}

          {resetError ? (
            <p className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
              {resetError}
            </p>
          ) : null}

          {resetMessage ? (
            <p className="rounded-lg border border-success/25 bg-success/5 px-3 py-2 text-[13px] text-success">
              {resetMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-semibold text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? t("auth.login.submitting") : t("auth.login.submit")}
          </button>
        </form>
      )}

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-muted">{t("auth.login.or")}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton label={t("auth.login.google")} className="w-full" />

      <p className="mt-6 text-center text-xs leading-relaxed text-muted">
        {t("auth.login.termsNotice")}
      </p>
    </div>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M19 12H5m0 0 6-6m-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

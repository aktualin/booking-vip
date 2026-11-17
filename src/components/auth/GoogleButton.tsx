"use client";

import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getClientAuth } from "@/lib/firebase-client";
import { signInUserWithGoogle } from "@/app/actions/user-auth";

/**
 * "Continue with Google" button.
 *
 * The popup runs in the browser (Firebase Web SDK); the resulting id token is
 * handed to the server, which verifies it and issues the session cookie.
 */
export default function GoogleButton({
  label = "Lanjut dengan Google",
  className = "w-full",
}: {
  label?: string;
  /** Width/utility classes for the button — defaults to full width. */
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const result = await signInWithPopup(
        getClientAuth(),
        new GoogleAuthProvider(),
      );
      const idToken = await result.user.getIdToken();
      // The action issues the cookie and redirects client-side; the root
      // AccountProvider re-reads the overview on that navigation, so the
      // header swaps to the account menu without a page reload.
      await signInUserWithGoogle(idToken);
    } catch (err) {
      // A successful sign-in ends in a server-side redirect, which rejects
      // the action promise with a NEXT_REDIRECT digest. That is navigation,
      // not a failure — let the router carry on without flashing an error.
      const digest = (err as { digest?: string })?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
        return;
      }
      const code = (err as { code?: string })?.code;
      // Closing the popup (or starting a second one) is a user choice, not
      // an error worth reporting.
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setPending(false);
        return;
      }
      // Keep the real error in the console — the generic banner alone makes
      // production failures impossible to diagnose.
      console.error("[google-sign-in]", err);
      setError(googleErrorMessage(err));
      setPending(false);
    }
  }

  // One wrapper element so the button + its error paragraph stay a single
  // grid item when the button sits in the two-column SSO grid.
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`inline-flex h-11 items-center justify-center gap-2.5 rounded-lg border border-line bg-white text-sm font-semibold text-ink transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        <GoogleIcon />
        {pending ? "Membuka Google…" : label}
      </button>
      {error ? (
        <p className="mt-2 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Turn a sign-in failure into something the visitor can act on. The codes
 * come from the Firebase Web SDK; anything unknown collapses into the
 * generic banner (the console keeps the full error).
 */
function googleErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/unauthorized-domain":
      return "Domain situs ini belum terdaftar di Firebase. Tambahkan domain produksi di Authentication → Settings → Authorized domains.";
    case "auth/popup-blocked":
      return "Popup Google diblokir browser. Izinkan popup untuk situs ini, lalu coba lagi.";
    case "auth/operation-not-allowed":
      return "Login Google belum diaktifkan. Aktifkan provider Google di Firebase Authentication → Sign-in method.";
    case "auth/network-request-failed":
      return "Gagal terhubung ke Firebase. Periksa koneksi internet, lalu coba lagi.";
    case "auth/invalid-api-key":
    case "auth/invalid-app-id":
    case "auth/auth-domain-config-required":
      return "Konfigurasi Firebase situs ini tidak valid. Hubungi pengelola situs.";
    case "auth/account-exists-with-different-credential":
      return "Email ini sudah terdaftar dengan metode lain. Silakan masuk dengan email & password.";
  }
  // getClientAuth() throws this when the NEXT_PUBLIC_* variables were not
  // present at build time — they are inlined into the bundle, so setting
  // them on the server alone does not help.
  const message = err instanceof Error ? err.message : "";
  if (message.includes("NEXT_PUBLIC_FIREBASE")) {
    return "Konfigurasi Firebase belum terpasang di build produksi. Hubungi pengelola situs.";
  }
  return "Gagal masuk dengan Google. Coba lagi.";
}

/** Inline Google "G" mark — avoids pulling in a brand asset. */
export function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.58-5.17 3.58-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

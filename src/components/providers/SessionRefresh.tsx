"use client";

import { useEffect, useRef } from "react";
import { refreshUserSession } from "@/app/actions/user-auth";
import { refreshAdminSession } from "@/app/actions/admin-auth";
import { getClientAuth } from "@/lib/firebase-client";

/**
 * Sliding session refresh — browser side.
 *
 * The server session cookie has a fixed TTL. While the tab is visible this
 * hook asks the matching server action to re-issue it with the full TTL, so
 * an active user (customer or admin) is never asked to sign in again:
 *
 *  - once on mount,
 *  - every 30 minutes while the tab is visible,
 *  - when the tab becomes visible again and the last attempt is 30+ minutes
 *    old (covers laptops waking from sleep and background tabs).
 *
 * Identity proof: when the browser Firebase SDK holds a user (Google
 * sign-in), its fresh id token is sent along — the SDK refreshes it
 * internally. Password sign-ins run entirely server-side and leave no
 * client SDK user; then the action is called without a token and renews
 * from the HttpOnly session cookie alone. Pages without a client Firebase
 * config simply take the same cookie path.
 *
 * Failures are silent: the next interval retries, and a truly dead session
 * falls back to the normal login flow. Renders nothing — safe to mount in
 * any layout without affecting SSR or hydration.
 */

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

type RefreshAction = (idToken?: string) => Promise<{ ok: boolean }>;

function useSessionRefresh(refresh: RefreshAction): void {
  const lastAttemptRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (cancelled || busyRef.current) return;
      if (document.visibilityState !== "visible") return;
      busyRef.current = true;
      try {
        let idToken: string | undefined;
        try {
          const user = getClientAuth().currentUser;
          if (user) idToken = await user.getIdToken(false);
        } catch {
          // No client Firebase config on this page — the action renews
          // from the session cookie alone.
        }
        if (cancelled) return;
        await refresh(idToken);
      } catch {
        // Silent: the next interval retries.
      } finally {
        busyRef.current = false;
        lastAttemptRef.current = Date.now();
      }
    }

    void run();
    const timer = setInterval(() => void run(), REFRESH_INTERVAL_MS);

    function onVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastAttemptRef.current >= REFRESH_INTERVAL_MS
      ) {
        void run();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      busyRef.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);
}

/** Mounted in the root layout — keeps customer sessions alive. */
export function UserSessionRefresh() {
  useSessionRefresh(refreshUserSession);
  return null;
}

/** Mounted in the admin shell — keeps admin sessions alive. */
export function AdminSessionRefresh() {
  useSessionRefresh(refreshAdminSession);
  return null;
}

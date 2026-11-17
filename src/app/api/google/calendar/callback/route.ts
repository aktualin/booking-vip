import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import {
  getOrderNotifications,
  saveOrderNotifications,
} from "@/lib/order-notifications";
import {
  exchangeGoogleCodeForTokens,
  GC_OAUTH_STATE_COOKIE,
} from "@/lib/google-calendar";

/**
 * The Google OAuth callback of the "Hubungkan Google Calendar" flow.
 *
 * Verifies the admin session and the `state` cookie, exchanges the `code`
 * for a refresh token + account email, merges them into the stored
 * notification configuration (leaving `enabled` and the other fields to the
 * settings form), and redirects back to the settings page with a status
 * query parameter the form turns into a toast.
 */

const SETTINGS_URL = "/admin/settings/notifications";

function back(params: Record<string, string>): NextResponse {
  const query = new URLSearchParams(params).toString();
  return NextResponse.redirect(`${SETTINGS_URL}?${query}`, {
    headers: {
      "Set-Cookie": `${GC_OAUTH_STATE_COOKIE}=; Path=/api/google/calendar; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return back({ gc: "error", msg: "Sesi admin tidak valid. Silakan masuk ulang." });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return back({
      gc: "error",
      msg: oauthError === "access_denied"
        ? "Izin ditolak di layar Google."
        : `Google mengembalikan error: ${oauthError}`,
    });
  }

  if (!code || !state) {
    return back({ gc: "error", msg: "Respons Google tidak lengkap (code/state hilang)." });
  }

  const expectedState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GC_OAUTH_STATE_COOKIE}=`))
    ?.slice(GC_OAUTH_STATE_COOKIE.length + 1);
  if (!expectedState || expectedState !== state) {
    return back({ gc: "error", msg: "State OAuth tidak cocok. Silakan coba lagi." });
  }

  try {
    const tokens = await exchangeGoogleCodeForTokens(code);

    const config = await getOrderNotifications();
    await saveOrderNotifications({
      ...config,
      googleCalendar: {
        ...config.googleCalendar,
        refreshToken: tokens.refreshToken,
        accountEmail: tokens.accountEmail,
      },
    });

    return back({ gc: "ok", email: tokens.accountEmail });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[google-calendar] OAuth callback failed", error);
    return back({ gc: "error", msg: message });
  }
}

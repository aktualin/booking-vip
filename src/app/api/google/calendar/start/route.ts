import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import { buildGoogleAuthUrl, GC_OAUTH_STATE_COOKIE } from "@/lib/google-calendar";

/**
 * Starts the "Hubungkan Google Calendar" OAuth flow.
 *
 * Admin-only: verifies the admin session cookie, drops a short-lived random
 * `state` cookie (CSRF protection, checked again by the callback route), and
 * redirects the browser to the Google consent screen. The settings form links
 * here directly, so this is a plain GET navigation.
 */

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Sesi admin tidak valid. Silakan masuk ulang." },
      { status: 401 },
    );
  }

  let url: string;
  try {
    const state = crypto.randomUUID();
    url = buildGoogleAuthUrl(state);
    return NextResponse.redirect(url, {
      headers: {
        "Set-Cookie": `${GC_OAUTH_STATE_COOKIE}=${state}; Path=/api/google/calendar; HttpOnly; SameSite=Lax; Max-Age=600`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[google-calendar] failed to build auth URL", error);
    return NextResponse.redirect(
      `/admin/settings/notifications?gc=error&msg=${encodeURIComponent(message)}`,
    );
  }
}

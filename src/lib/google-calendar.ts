import "server-only";

import { OAuth2Client } from "google-auth-library";
import {
  appBaseUrl,
  buildAdminOrderSummary,
  getOrderNotifications,
  isGoogleCalendarReady,
  type AdminOrderSummary,
  type GoogleCalendarConfig,
  type TestResult,
} from "@/lib/order-notifications";

/**
 * Google Calendar sync — order events + email invitations + popup alarms.
 *
 * One Google account is connected through the admin settings page
 * ("Hubungkan Google Calendar"): the OAuth consent flow in
 * `/api/google/calendar/start` → `/api/google/calendar/callback` captures a
 * long-lived refresh token, which is stored in the `orderNotifications`
 * Setting JSON next to the SMTP password and the Telegram bot token.
 *
 * When an order is paid, `syncOrderToGoogleCalendar` creates one event on
 * the configured calendar at the booking's service time. Guests
 * (`attendees`) receive an email invitation from Google (`sendUpdates=all`)
 * — that is the notification channel — and the calendar owner gets popup
 * alarms at the configured minutes-before offsets.
 *
 * Everything here is fire-and-forget from the payment flow: failures are
 * logged and swallowed, never thrown into `confirmPaidPayment`.
 *
 * Uses the Calendar API v3 REST surface directly
 * (https://developers.google.com/workspace/calendar/api/v3/reference) with
 * access tokens minted by `google-auth-library` — no extra SDK needed.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
/** Cookie carrying the OAuth `state` between the start and callback routes. */
export const GC_OAUTH_STATE_COOKIE = "gc_oauth_state";
/** Event timezone — service times are always presented in WIB. */
const EVENT_TIMEZONE = "Asia/Jakarta";
const REQUEST_TIMEOUT_MS = 15_000;

// ---------- OAuth plumbing ----------

function oauthCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum di-set di environment.");
  }
  return { clientId, clientSecret };
}

/** The registered redirect URI of the OAuth callback route. */
export function googleCalendarRedirectUri(): string {
  return `${appBaseUrl()}/api/google/calendar/callback`;
}

function buildOAuthClient(refreshToken?: string): OAuth2Client {
  const { clientId, clientSecret } = oauthCredentials();
  const client = new OAuth2Client(clientId, clientSecret, googleCalendarRedirectUri());
  if (refreshToken) {
    client.setCredentials({ refresh_token: refreshToken });
  }
  return client;
}

/**
 * Build the Google consent URL the admin is redirected to.
 *
 * `access_type=offline` + `prompt=consent` guarantee a refresh token is
 * returned even if the account has granted access before. The `state`
 * round-trips through the callback for CSRF protection.
 */
export function buildGoogleAuthUrl(state: string): string {
  return buildOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    state,
  });
}

/** The tokens captured by the OAuth callback. */
export type GoogleCalendarTokens = {
  refreshToken: string;
  accountEmail: string;
};

/**
 * Exchange an OAuth `code` for a refresh token + the account email.
 * Throws on any failure — the callback route turns it into an error page.
 */
export async function exchangeGoogleCodeForTokens(code: string): Promise<GoogleCalendarTokens> {
  const client = buildOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google tidak mengembalikan refresh token. Cabut akses aplikasi di myaccount.google.com/permissions lalu coba lagi.",
    );
  }

  client.setCredentials(tokens);
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Gagal membaca akun Google (userinfo ${res.status}).`);
  }
  const info = (await res.json()) as { email?: string };
  if (!info.email) throw new Error("Akun Google tidak mengembalikan email.");

  return { refreshToken: tokens.refresh_token, accountEmail: info.email };
}

// ---------- Calendar API ----------

/** Mint a short-lived access token from the stored refresh token. */
async function accessTokenFor(refreshToken: string): Promise<string> {
  const client = buildOAuthClient(refreshToken);
  const token = await client.getAccessToken();
  if (typeof token === "string") return token;
  if (token?.token) return token.token;
  throw new Error("Gagal memperoleh access token Google.");
}

/** The request body of `events.insert`. */
type CalendarEventBody = {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: { email: string }[];
  reminders?: {
    useDefault: false;
    overrides: { method: "popup" | "email"; minutes: number }[];
  };
  source?: { title: string; url: string };
};

/**
 * Insert one event. `sendUpdates=all` makes Google email every attendee —
 * the notification half of the integration. Returns the created event id.
 */
async function insertEvent(
  config: GoogleCalendarConfig,
  event: CalendarEventBody,
): Promise<string> {
  const token = await accessTokenFor(config.refreshToken);
  const calendarId = encodeURIComponent(config.calendarId || "primary");
  const res = await fetch(
    `${CALENDAR_API}/calendars/${calendarId}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Calendar API ${res.status}: ${body.slice(0, 300)}`);
  }
  const created = (await res.json()) as { id?: string; htmlLink?: string };
  if (!created.id) throw new Error("Calendar API tidak mengembalikan event id.");
  return created.id;
}

// ---------- event payloads ----------

function buildOrderEvent(
  config: GoogleCalendarConfig,
  s: AdminOrderSummary,
): CalendarEventBody {
  const start = new Date(s.serviceAtIso);
  const end = new Date(start.getTime() + config.durationMinutes * 60_000);

  const description = [
    `Order baru DIBAYAR ✅`,
    ``,
    `Kode order  : ${s.code}`,
    `Layanan     : ${s.serviceLabel}`,
    `Jenis       : ${s.orderType === "evoa" ? "e-VOA" : "Booking"}`,
    `Total       : $${(s.totalUsdCents / 100).toFixed(2)} USD`,
    s.invoiceNumber ? `Invoice     : ${s.invoiceNumber}` : null,
    `Pelanggan   : ${s.customerName || "-"}`,
    s.customerPhone ? `Telepon     : ${s.customerPhone}` : null,
    ``,
    `Voucher     : ${s.voucherUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: `[Booking VIP] ${s.code} — ${s.serviceLabel}`,
    description,
    ...(s.location ? { location: s.location } : {}),
    start: { dateTime: start.toISOString(), timeZone: EVENT_TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: EVENT_TIMEZONE },
    ...(config.attendees.length > 0
      ? { attendees: config.attendees.map((email) => ({ email })) }
      : {}),
    reminders: {
      useDefault: false,
      // Popup alarms on the owner's devices at the configured offsets.
      overrides: config.reminderMinutes.map((minutes) => ({
        method: "popup" as const,
        minutes,
      })),
    },
    source: { title: `Voucher ${s.code}`, url: s.voucherUrl },
  };
}

// ---------- public entry points ----------

/**
 * Create the calendar event for a just-paid booking.
 *
 * Called fire-and-forget from `confirmPaidPayment` on the first paid
 * transition only (the same guard the notifications use), so no dedupe is
 * needed here. Never throws: a disabled/unconnected channel is a silent
 * no-op and every API error is logged and swallowed.
 */
export async function syncOrderToGoogleCalendar(bookingId: string): Promise<void> {
  try {
    const config = (await getOrderNotifications()).googleCalendar;
    if (!isGoogleCalendarReady(config)) return;

    const summary = await buildAdminOrderSummary(bookingId);
    if (!summary) {
      console.error("[google-calendar] no booking found for", bookingId);
      return;
    }

    const eventId = await insertEvent(config, buildOrderEvent(config, summary));
    console.info("[google-calendar] order event created", {
      booking: summary.code,
      eventId,
      attendees: config.attendees.length,
    });
  } catch (error) {
    console.error("[google-calendar] syncOrderToGoogleCalendar failed", error);
  }
}

/**
 * Create a test event (10 minutes from now, 30 minutes long) using the
 * supplied — possibly unsaved — config. Backs the admin "Kirim Tes" button.
 */
export async function testGoogleCalendar(c: GoogleCalendarConfig): Promise<TestResult> {
  if (!c.refreshToken.trim()) {
    return { ok: false, error: "Akun Google belum dihubungkan." };
  }
  try {
    const start = new Date(Date.now() + 10 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const id = await insertEvent(c, {
      summary: "[Booking VIP] Uji integrasi Google Calendar",
      description:
        "Ini adalah event uji dari pengaturan Notifikasi Order Booking VIP. Jika Anda melihat event ini, integrasi Google Calendar sudah benar.",
      start: { dateTime: start.toISOString(), timeZone: EVENT_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: EVENT_TIMEZONE },
      ...(c.attendees.length > 0
        ? { attendees: c.attendees.map((email) => ({ email })) }
        : {}),
      reminders: {
        useDefault: false,
        overrides: c.reminderMinutes.map((minutes) => ({
          method: "popup" as const,
          minutes,
        })),
      },
    });
    console.info("[google-calendar] test event created", { id });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

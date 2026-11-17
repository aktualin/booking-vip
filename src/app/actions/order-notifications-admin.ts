"use server";

import { getAdminSession } from "@/lib/admin/session";
import {
  getOrderNotifications,
  parseOrderNotifications,
  saveOrderNotifications,
  testSmtp,
  testTelegram,
  type OrderNotificationsDTO,
  type TestResult,
} from "@/lib/order-notifications";
import { testGoogleCalendar } from "@/lib/google-calendar";

/**
 * The admin actions of the order notifications (email + Telegram).
 *
 * All three are gated by the admin session — the same check the rest of the
 * admin area uses. The layout already guards the page, but an action can be
 * called directly, so the check is repeated here.
 */

export type OrderNotificationsSaveResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Read the notification configuration for the admin form. */
export async function loadOrderNotifications(): Promise<OrderNotificationsDTO> {
  const session = await getAdminSession();
  if (!session) {
    return parseOrderNotifications(null);
  }
  const config = await getOrderNotifications();
  // The refresh token is never needed by the form (the server merges the
  // stored value back on save/test), so keep it out of the client payload.
  return {
    ...config,
    googleCalendar: { ...config.googleCalendar, refreshToken: "" },
  };
}

/**
 * Normalise the submitted form values and merge the stored secrets.
 *
 * A blank `smtp.pass` / `telegram.botToken` means "keep what is stored" so
 * the operator can save the other fields without retyping the secret. The
 * Google Calendar refresh token is only ever written by the OAuth callback,
 * so the form never submits it — the stored token and account email always
 * win.
 */
async function resolveDto(values: Record<string, unknown>): Promise<OrderNotificationsDTO> {
  const dto = parseOrderNotifications({
    smtp: values.smtp,
    telegram: values.telegram,
    googleCalendar: values.googleCalendar,
  });
  const stored = await getOrderNotifications();

  if (dto.smtp.pass.trim() === "" && stored.smtp.pass.trim() !== "") {
    dto.smtp = { ...dto.smtp, pass: stored.smtp.pass };
  }
  if (dto.telegram.botToken.trim() === "" && stored.telegram.botToken.trim() !== "") {
    dto.telegram = { ...dto.telegram, botToken: stored.telegram.botToken };
  }
  dto.googleCalendar = {
    ...dto.googleCalendar,
    refreshToken: stored.googleCalendar.refreshToken,
    accountEmail: stored.googleCalendar.accountEmail,
  };
  return dto;
}

/** The raw smtp section of the submitted values (may be missing). */
function rawSmtp(values: Record<string, unknown>): Record<string, unknown> {
  const raw = values.smtp;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/**
 * Save the notification configuration.
 *
 * The values arrive as a JSON-serialisable `{ smtp, telegram }` object from
 * the form. They are normalised with the same rules as the stored JSON
 * (`parseOrderNotifications`), then validated per enabled channel.
 */
export async function saveOrderNotificationsAction(
  values: Record<string, unknown>,
): Promise<OrderNotificationsSaveResult> {
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, error: "Sesi admin tidak valid. Silakan masuk ulang." };
  }

  const dto = await resolveDto(values);

  if (dto.smtp.enabled) {
    if (!dto.smtp.host) {
      return {
        ok: false,
        error: "Host SMTP wajib diisi ketika email aktif.",
        field: "smtp.host",
      };
    }

    const rawPort = Number(rawSmtp(values).port);
    if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
      return {
        ok: false,
        error: "Port SMTP harus angka antara 1 dan 65535.",
        field: "smtp.port",
      };
    }

    if (!EMAIL_RE.test(dto.smtp.fromEmail)) {
      return {
        ok: false,
        error: "Email pengirim tidak valid.",
        field: "smtp.fromEmail",
      };
    }

    if (dto.smtp.recipients.length === 0) {
      return {
        ok: false,
        error: "Minimal satu penerima email ketika email aktif.",
        field: "smtp.recipients",
      };
    }

    const invalid = dto.smtp.recipients.find((email) => !EMAIL_RE.test(email));
    if (invalid) {
      return {
        ok: false,
        error: `Email penerima tidak valid: ${invalid}`,
        field: "smtp.recipients",
      };
    }
  }

  if (dto.telegram.enabled) {
    if (!dto.telegram.botToken.trim()) {
      return {
        ok: false,
        error: "Bot token wajib diisi ketika Telegram aktif.",
        field: "telegram.botToken",
      };
    }

    if (dto.telegram.chatIds.length === 0) {
      return {
        ok: false,
        error: "Minimal satu chat id ketika Telegram aktif.",
        field: "telegram.chatIds",
      };
    }
  }

  if (dto.googleCalendar.enabled) {
    if (!dto.googleCalendar.refreshToken.trim()) {
      return {
        ok: false,
        error:
          "Hubungkan akun Google terlebih dahulu sebelum mengaktifkan Google Calendar.",
        field: "googleCalendar.refreshToken",
      };
    }

    const invalidAttendee = dto.googleCalendar.attendees.find(
      (email) => !EMAIL_RE.test(email),
    );
    if (invalidAttendee) {
      return {
        ok: false,
        error: `Email penerima undangan tidak valid: ${invalidAttendee}`,
        field: "googleCalendar.attendees",
      };
    }
  }

  try {
    await saveOrderNotifications(dto);
  } catch {
    return { ok: false, error: "Gagal menyimpan pengaturan notifikasi." };
  }

  return { ok: true, message: "Pengaturan notifikasi berhasil disimpan." };
}

/**
 * Send a test message through one channel using the current (possibly
 * unsaved) form values, with the same normalisation and secret merge as the
 * save action.
 */
export async function testOrderNotificationAction(
  channel: "smtp" | "telegram" | "googleCalendar",
  values: Record<string, unknown>,
): Promise<TestResult> {
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, error: "Sesi admin tidak valid. Silakan masuk ulang." };
  }

  const dto = await resolveDto(values);
  if (channel === "smtp") return testSmtp(dto.smtp);
  if (channel === "telegram") return testTelegram(dto.telegram);
  return testGoogleCalendar(dto.googleCalendar);
}

/**
 * Forget the connected Google account (refresh token + email) and turn the
 * Google Calendar channel off. The Google-side grant should also be revoked
 * by the operator at myaccount.google.com/permissions.
 */
export async function disconnectGoogleCalendarAction(): Promise<TestResult> {
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, error: "Sesi admin tidak valid. Silakan masuk ulang." };
  }

  try {
    const config = await getOrderNotifications();
    await saveOrderNotifications({
      ...config,
      googleCalendar: {
        ...config.googleCalendar,
        enabled: false,
        refreshToken: "",
        accountEmail: "",
      },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Gagal memutuskan koneksi Google Calendar." };
  }
}

"use server";

import { getAdminSession } from "@/lib/admin/session";
import {
  DEFAULT_ORDER_NOTIFICATIONS,
  getOrderNotifications,
  parseOrderNotifications,
  saveOrderNotifications,
  testSmtp,
  testTelegram,
  type OrderNotificationsDTO,
  type TestResult,
} from "@/lib/order-notifications";

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
    return {
      smtp: { ...DEFAULT_ORDER_NOTIFICATIONS.smtp, recipients: [] },
      telegram: { ...DEFAULT_ORDER_NOTIFICATIONS.telegram, chatIds: [] },
    };
  }
  return getOrderNotifications();
}

/**
 * Normalise the submitted form values and merge the stored secrets.
 *
 * A blank `smtp.pass` / `telegram.botToken` means "keep what is stored" so
 * the operator can save the other fields without retyping the secret.
 */
async function resolveDto(values: Record<string, unknown>): Promise<OrderNotificationsDTO> {
  const dto = parseOrderNotifications({ smtp: values.smtp, telegram: values.telegram });
  const stored = await getOrderNotifications();

  if (dto.smtp.pass.trim() === "" && stored.smtp.pass.trim() !== "") {
    dto.smtp = { ...dto.smtp, pass: stored.smtp.pass };
  }
  if (dto.telegram.botToken.trim() === "" && stored.telegram.botToken.trim() !== "") {
    dto.telegram = { ...dto.telegram, botToken: stored.telegram.botToken };
  }
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
  channel: "smtp" | "telegram",
  values: Record<string, unknown>,
): Promise<TestResult> {
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, error: "Sesi admin tidak valid. Silakan masuk ulang." };
  }

  const dto = await resolveDto(values);
  return channel === "smtp" ? testSmtp(dto.smtp) : testTelegram(dto.telegram);
}

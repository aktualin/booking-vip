import "server-only";

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db } from "@/prisma/db";

/**
 * Admin order notifications — email (SMTP) and Telegram.
 *
 * The configuration lives in the `Setting` table under the key
 * `orderNotifications` as a single JSON object (the same pattern as
 * `home.popup` / `promo.campaigns`), so an operator can change it without a
 * deploy. Both channels default to **disabled** and can be turned on
 * independently or together. Each channel supports **multiple recipients**.
 *
 *   {
 *     "smtp":     { "enabled": false, "host": "", "port": 587, "secure": false,
 *                   "user": "", "pass": "", "fromName": "", "fromEmail": "",
 *                   "recipients": ["ops@x.com"] },
 *     "telegram": { "enabled": false, "botToken": "", "chatIds": ["123456789"] }
 *   }
 *
 * Delivery is fire-and-forget and never blocks or fails the payment flow:
 * every send path is wrapped and swallows its own errors (the caller in
 * `src/lib/payments.ts` also `.catch()`es). SMTP credentials and the Telegram
 * bot token are stored in the database (plaintext) per the product decision —
 * they are only ever readable through the authenticated admin action.
 */

export const ORDER_NOTIFICATIONS_KEY = "orderNotifications";

/** SMTP channel configuration. */
export type SmtpConfig = {
  enabled: boolean;
  host: string;
  /** 25 / 587 (STARTTLS) or 465 (implicit TLS). */
  port: number;
  /** Implicit TLS (port 465). Leave false for STARTTLS on 587/25. */
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  /** One or more destination addresses. */
  recipients: string[];
};

/** Telegram channel configuration. */
export type TelegramConfig = {
  enabled: boolean;
  botToken: string;
  /** One or more chat ids (user, group `-…`, or channel `@name`). */
  chatIds: string[];
};

export type OrderNotificationsDTO = {
  smtp: SmtpConfig;
  telegram: TelegramConfig;
};

/** The configuration used when nothing has been saved yet — everything off. */
export const DEFAULT_ORDER_NOTIFICATIONS: OrderNotificationsDTO = {
  smtp: {
    enabled: false,
    host: "",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    fromName: "",
    fromEmail: "",
    recipients: [],
  },
  telegram: {
    enabled: false,
    botToken: "",
    chatIds: [],
  },
};

// ---------- parsing helpers ----------

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Normalise a raw JSON array into a trimmed, de-duplicated string list. */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function parseSmtp(raw: unknown): SmtpConfig {
  const d = DEFAULT_ORDER_NOTIFICATIONS.smtp;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d, recipients: [] };
  const v = raw as Record<string, unknown>;
  return {
    enabled: readBoolean(v.enabled, d.enabled),
    host: readString(v.host, d.host).trim(),
    port: Math.max(1, Math.min(65535, Math.trunc(readNumber(v.port, d.port)))),
    secure: readBoolean(v.secure, d.secure),
    user: readString(v.user, d.user).trim(),
    pass: readString(v.pass, d.pass),
    fromName: readString(v.fromName, d.fromName).trim(),
    fromEmail: readString(v.fromEmail, d.fromEmail).trim(),
    recipients: readStringList(v.recipients),
  };
}

function parseTelegram(raw: unknown): TelegramConfig {
  const d = DEFAULT_ORDER_NOTIFICATIONS.telegram;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d, chatIds: [] };
  const v = raw as Record<string, unknown>;
  return {
    enabled: readBoolean(v.enabled, d.enabled),
    botToken: readString(v.botToken, d.botToken).trim(),
    chatIds: readStringList(v.chatIds),
  };
}

/** Normalise a raw JSON value into the notification configuration. */
export function parseOrderNotifications(raw: unknown): OrderNotificationsDTO {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      smtp: { ...DEFAULT_ORDER_NOTIFICATIONS.smtp, recipients: [] },
      telegram: { ...DEFAULT_ORDER_NOTIFICATIONS.telegram, chatIds: [] },
    };
  }
  const value = raw as Record<string, unknown>;
  return {
    smtp: parseSmtp(value.smtp),
    telegram: parseTelegram(value.telegram),
  };
}

// ---------- storage ----------

/** Read the configuration from the database (defaults on any problem). */
export async function getOrderNotifications(): Promise<OrderNotificationsDTO> {
  try {
    const rows = await db.orm.public.Setting
      .select("key", "value")
      .where({ key: ORDER_NOTIFICATIONS_KEY })
      .all();
    const raw = rows[0]?.value;
    if (raw == null) return parseOrderNotifications(null);
    return parseOrderNotifications(raw);
  } catch {
    return parseOrderNotifications(null);
  }
}

/** Create-or-update the single configuration row. */
export async function saveOrderNotifications(dto: OrderNotificationsDTO): Promise<void> {
  const value = {
    smtp: {
      enabled: dto.smtp.enabled,
      host: dto.smtp.host,
      port: dto.smtp.port,
      secure: dto.smtp.secure,
      user: dto.smtp.user,
      pass: dto.smtp.pass,
      fromName: dto.smtp.fromName,
      fromEmail: dto.smtp.fromEmail,
      recipients: dto.smtp.recipients,
    },
    telegram: {
      enabled: dto.telegram.enabled,
      botToken: dto.telegram.botToken,
      chatIds: dto.telegram.chatIds,
    },
  };

  const existing = await db.orm.public.Setting
    .select("key")
    .where({ key: ORDER_NOTIFICATIONS_KEY })
    .first();

  if (existing) {
    await db.orm.public.Setting
      .where({ key: ORDER_NOTIFICATIONS_KEY })
      .update({ value: value as never });
    return;
  }

  await db.orm.public.Setting.create({
    key: ORDER_NOTIFICATIONS_KEY,
    value: value as never,
  });
}

// ---------- transports ----------

/** Is the SMTP channel usable (enabled + host + at least one recipient)? */
export function isSmtpReady(c: SmtpConfig): boolean {
  return c.enabled && c.host.trim().length > 0 && c.recipients.length > 0;
}

/** Is the Telegram channel usable (enabled + token + at least one chat)? */
export function isTelegramReady(c: TelegramConfig): boolean {
  return c.enabled && c.botToken.trim().length > 0 && c.chatIds.length > 0;
}

function buildTransport(c: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user || c.pass ? { user: c.user, pass: c.pass } : undefined,
  });
}

/**
 * Send one email to every recipient. Returns false (never throws) when the
 * channel is not ready or the transport fails — callers must not depend on it.
 */
export async function sendEmail(
  c: SmtpConfig,
  subject: string,
  text: string,
  html?: string,
): Promise<boolean> {
  if (!isSmtpReady(c)) {
    console.info("[order-notifications] email skipped (SMTP not ready)");
    return false;
  }
  try {
    const from = c.fromEmail
      ? c.fromName
        ? `"${c.fromName}" <${c.fromEmail}>`
        : c.fromEmail
      : undefined;
    await buildTransport(c).sendMail({
      from,
      to: c.recipients.join(", "),
      subject,
      text,
      ...(html ? { html } : {}),
    });
    console.info("[order-notifications] email sent", { to: c.recipients.length });
    return true;
  } catch (error) {
    console.error("[order-notifications] email send failed", error);
    return false;
  }
}

/**
 * Send one Telegram message to every chat id. Returns false (never throws)
 * when the channel is not ready or the Bot API rejects the call.
 */
export async function sendTelegram(c: TelegramConfig, text: string): Promise<boolean> {
  if (!isTelegramReady(c)) {
    console.info("[order-notifications] telegram skipped (not ready)");
    return false;
  }
  let ok = true;
  for (const chatId of c.chatIds) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(c.botToken)}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("[order-notifications] telegram send failed", chatId, res.status, body.slice(0, 300));
        ok = false;
      }
    } catch (error) {
      console.error("[order-notifications] telegram send error", chatId, error);
      ok = false;
    }
  }
  return ok;
}

// ---------- test sends (admin "Kirim Tes" button) ----------

export type TestResult = { ok: boolean; error?: string };

/** Send a test email using the supplied (possibly unsaved) config. */
export async function testSmtp(c: SmtpConfig): Promise<TestResult> {
  if (!c.host.trim()) return { ok: false, error: "Host SMTP kosong." };
  if (c.recipients.length === 0) return { ok: false, error: "Belum ada penerima email." };
  try {
    const from = c.fromEmail
      ? c.fromName
        ? `"${c.fromName}" <${c.fromEmail}>`
        : c.fromEmail
      : undefined;
    await buildTransport(c).sendMail({
      from,
      to: c.recipients.join(", "),
      subject: "[Booking VIP] Uji notifikasi order",
      text: "Ini adalah pesan uji dari pengaturan Notifikasi Order Booking VIP. Jika Anda menerima email ini, konfigurasi SMTP sudah benar.",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Send a test Telegram message using the supplied (possibly unsaved) config. */
export async function testTelegram(c: TelegramConfig): Promise<TestResult> {
  if (!c.botToken.trim()) return { ok: false, error: "Bot token kosong." };
  if (c.chatIds.length === 0) return { ok: false, error: "Belum ada chat id Telegram." };
  try {
    let firstError: string | undefined;
    for (const chatId of c.chatIds) {
      const res = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(c.botToken)}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "✅ Uji notifikasi order Booking VIP berhasil. Konfigurasi Telegram sudah benar.",
            disable_web_page_preview: true,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        firstError ??=
          (body as { description?: string }).description ||
          `Telegram menjawab ${res.status}`;
      }
    }
    return firstError ? { ok: false, error: firstError } : { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ---------- the order-paid notification ----------

/** The compact order summary handed to both channels. */
type AdminOrderSummary = {
  code: string;
  serviceLabel: string;
  orderType: "booking" | "evoa";
  totalUsdCents: number;
  invoiceNumber: string | null;
  customerName: string;
  customerPhone: string | null;
  serviceAtLabel: string;
  voucherUrl: string;
};

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)} USD`;
}

function formatServiceDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function e164Phone(countryCode: string, phone: string): string | null {
  const cc = (countryCode ?? "").replace(/\D/g, "");
  const num = (phone ?? "").replace(/\D/g, "");
  if (!num) return null;
  const full = cc ? `+${cc}${num}` : `+${num}`;
  return /^\+\d{9,15}$/.test(full) ? full : null;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

/** Assemble the admin-facing summary of a just-paid booking. */
async function buildAdminOrderSummary(bookingId: string): Promise<AdminOrderSummary | null> {
  const bookings = await db.orm.public.Booking
    .select("code", "serviceAt", "totalUsdCents", "invoiceNumber")
    .where((f) => f.id.eq(bookingId))
    .limit(1)
    .all();
  const booking = bookings[0];
  if (!booking) return null;

  const contacts = await db.orm.public.Contact
    .select("firstName", "lastName", "phoneCountryCode", "phone")
    .where((f) => f.bookingId.eq(bookingId))
    .limit(1)
    .all();
  const contact = contacts[0];

  const items = await db.orm.public.BookingItem
    .select("label")
    .where((f) => f.bookingId.eq(bookingId))
    .limit(1)
    .all();

  let orderType: AdminOrderSummary["orderType"] = "booking";
  try {
    const apps = await db.orm.public.VisaApplication
      .select("id")
      .where((f) => f.bookingId.eq(bookingId))
      .limit(1)
      .all();
    if (apps[0]) orderType = "evoa";
  } catch {
    // e-VOA table unavailable — treat as a normal booking.
  }

  const base = appBaseUrl();
  return {
    code: booking.code,
    serviceLabel: items[0]?.label ?? (orderType === "evoa" ? "e-VOA" : "Pesanan Booking VIP"),
    orderType,
    totalUsdCents: booking.totalUsdCents,
    invoiceNumber: booking.invoiceNumber ?? null,
    customerName: contact ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() : "",
    customerPhone: contact
      ? e164Phone(contact.phoneCountryCode ?? "", contact.phone ?? "")
      : null,
    serviceAtLabel: formatServiceDate(new Date(booking.serviceAt).toISOString()),
    voucherUrl: `${base}/voucher/${encodeURIComponent(booking.code)}`,
  };
}

function buildSubject(s: AdminOrderSummary): string {
  return `[Booking VIP] Order dibayar — ${s.code}`;
}

function buildPlainText(s: AdminOrderSummary): string {
  const lines = [
    "Order baru sudah DIBAYAR ✅",
    "",
    `Kode order   : ${s.code}`,
    `Layanan      : ${s.serviceLabel}`,
    `Jenis        : ${s.orderType === "evoa" ? "e-VOA" : "Booking"}`,
    `Total        : ${formatUsd(s.totalUsdCents)}`,
    s.invoiceNumber ? `Invoice      : ${s.invoiceNumber}` : null,
    `Pelanggan    : ${s.customerName || "-"}`,
    s.customerPhone ? `Telepon      : ${s.customerPhone}` : null,
    `Tgl layanan  : ${s.serviceAtLabel} WIB`,
    "",
    `Voucher      : ${s.voucherUrl}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function buildHtml(s: AdminOrderSummary): string {
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0;font-weight:600">${v}</td></tr>`;
  return [
    `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px">`,
    `<h2 style="margin:0 0 4px;font-size:18px">Order dibayar ✅</h2>`,
    `<p style="margin:0 0 16px;color:#666">Pembayaran diterima untuk order berikut.</p>`,
    `<table style="border-collapse:collapse;font-size:14px">`,
    row("Kode order", s.code),
    row("Layanan", s.serviceLabel),
    row("Jenis", s.orderType === "evoa" ? "e-VOA" : "Booking"),
    row("Total", formatUsd(s.totalUsdCents)),
    s.invoiceNumber ? row("Invoice", s.invoiceNumber) : "",
    row("Pelanggan", s.customerName || "-"),
    s.customerPhone ? row("Telepon", s.customerPhone) : "",
    row("Tgl layanan", `${s.serviceAtLabel} WIB`),
    `</table>`,
    `<p style="margin:16px 0 0"><a href="${s.voucherUrl}" style="color:#0a7">Lihat voucher</a></p>`,
    `</div>`,
  ].join("");
}

function buildTelegramText(s: AdminOrderSummary): string {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `✅ <b>Order dibayar</b>`,
    ``,
    `<b>Kode:</b> ${esc(s.code)}`,
    `<b>Layanan:</b> ${esc(s.serviceLabel)}`,
    `<b>Jenis:</b> ${s.orderType === "evoa" ? "e-VOA" : "Booking"}`,
    `<b>Total:</b> ${formatUsd(s.totalUsdCents)}`,
    s.invoiceNumber ? `<b>Invoice:</b> ${esc(s.invoiceNumber)}` : null,
    `<b>Pelanggan:</b> ${esc(s.customerName || "-")}`,
    s.customerPhone ? `<b>Telepon:</b> ${esc(s.customerPhone)}` : null,
    `<b>Tgl layanan:</b> ${esc(s.serviceAtLabel)} WIB`,
    ``,
    `<a href="${s.voucherUrl}">Lihat voucher</a>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Notify the configured admin channels that an order was paid.
 *
 * Called fire-and-forget from `confirmPaidPayment` on the first paid
 * transition only. Never throws: a missing/disabled channel or any transport
 * error is logged and swallowed so the payment confirmation is never affected.
 */
export async function notifyAdminOrderPaid(bookingId: string): Promise<void> {
  try {
    const config = await getOrderNotifications();
    if (!isSmtpReady(config.smtp) && !isTelegramReady(config.telegram)) {
      return; // nothing enabled — silent no-op
    }

    const summary = await buildAdminOrderSummary(bookingId);
    if (!summary) {
      console.error("[order-notifications] no booking found for", bookingId);
      return;
    }

    if (isSmtpReady(config.smtp)) {
      await sendEmail(
        config.smtp,
        buildSubject(summary),
        buildPlainText(summary),
        buildHtml(summary),
      );
    }
    if (isTelegramReady(config.telegram)) {
      await sendTelegram(config.telegram, buildTelegramText(summary));
    }
  } catch (error) {
    console.error("[order-notifications] notifyAdminOrderPaid failed", error);
  }
}

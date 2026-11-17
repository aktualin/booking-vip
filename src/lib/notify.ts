import "server-only";

/**
 * The booking confirmation notifier — graceful by design.
 *
 * When Twilio is configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
 * TWILIO_WHATSAPP_FROM) the customer gets a WhatsApp message with the
 * booking summary and the e-voucher link. When it is not configured the
 * notification is skipped with a log line — the booking / payment flow is
 * NEVER blocked or failed by a notification problem (every path is wrapped
 * and callers fire-and-forget).
 *
 * The message is sent with the Twilio REST API over plain fetch — no extra
 * dependency is needed. Credentials live in the environment only.
 */

/** Everything the confirmation message needs — assembled server-side. */
export type BookingConfirmationSummary = {
  code: string;
  tourTitle: string;
  packageLabel?: string | null;
  /** ISO datetime of the service (the departure time for join-in tours). */
  serviceAt: string;
  /** "HH:MM" of the join-in departure, when there is one. */
  departureStartTime?: string | null;
  adultCount: number;
  childCount: number;
  infantCount: number;
  hotelName?: string | null;
  pickupLabel?: string | null;
  totalUsdCents: number;
  invoiceNumber?: string | null;
  contactName: string;
  /** The customer phone in E.164 format (e.g. "+6281234567890"). */
  contactPhone?: string | null;
  /** Absolute URL of the e-voucher page. */
  voucherUrl: string;
};

/** Is the WhatsApp notifier configured? */
export function isNotifyConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_WHATSAPP_FROM?.trim(),
  );
}

/** A Twilio WhatsApp address — "whatsapp:+…" (the prefix is idempotent). */
function waAddress(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

/** A plausible E.164 destination — anything else is skipped, never guessed. */
function waDestination(phone: string | null | undefined): string | null {
  const trimmed = (phone ?? "").trim();
  if (!/^\+\d{9,15}$/.test(trimmed)) return null;
  return trimmed;
}

/** Format the service date for the message (Indonesian, WIB). */
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

/** The Indonesian confirmation message. */
function buildMessage(summary: BookingConfirmationSummary): string {
  const lines: string[] = [];
  lines.push(`Halo ${summary.contactName || "Kak"}! 👋`);
  lines.push(
    `Pembayaran pesanan *${summary.code}* sudah kami terima. Pesanan kamu RESMI dikonfirmasi. ✅`,
  );
  lines.push("");
  lines.push(`*${summary.tourTitle}*`);
  if (summary.packageLabel) lines.push(`Paket: ${summary.packageLabel}`);
  lines.push(`Tanggal: ${formatServiceDate(summary.serviceAt)} WIB`);
  const pax = [
    `${summary.adultCount} dewasa`,
    summary.childCount > 0 ? `${summary.childCount} anak` : null,
    summary.infantCount > 0 ? `${summary.infantCount} bayi` : null,
  ]
    .filter(Boolean)
    .join(", ");
  lines.push(`Penumpang: ${pax}`);
  if (summary.hotelName) lines.push(`Hotel / titik jemput: ${summary.hotelName}`);
  else if (summary.pickupLabel) lines.push(`Titik jemput: ${summary.pickupLabel}`);
  lines.push(`Total: $${(summary.totalUsdCents / 100).toFixed(2)} USD`);
  if (summary.invoiceNumber) lines.push(`Invoice: ${summary.invoiceNumber}`);
  lines.push("");
  lines.push(`E-voucher (tunjukkan saat penjemputan): ${summary.voucherUrl}`);
  lines.push("");
  lines.push("Terima kasih sudah memesan bersama Booking VIP. Sampai jumpa di lokasi! 🌴");
  return lines.join("\n");
}

/**
 * Send the booking confirmation over WhatsApp (Twilio REST).
 *
 * Never throws: a missing configuration logs a skip, a missing/invalid
 * phone logs a skip, and any transport error is logged and swallowed — the
 * caller's payment confirmation must never depend on this.
 */
export async function sendBookingConfirmation(
  summary: BookingConfirmationSummary,
): Promise<void> {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
    if (!sid || !token || !from) {
      console.info("[notify] skipped (not configured)", summary.code);
      return;
    }

    const to = waDestination(summary.contactPhone);
    if (!to) {
      console.info("[notify] skipped (no usable customer phone)", summary.code);
      return;
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: waAddress(from),
          To: waAddress(to),
          Body: buildMessage(summary),
        }).toString(),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        "[notify] WhatsApp send failed",
        summary.code,
        response.status,
        text.slice(0, 300),
      );
      return;
    }

    console.info("[notify] WhatsApp confirmation sent", summary.code);
  } catch (error) {
    console.error("[notify] could not send the booking confirmation", error);
  }
}
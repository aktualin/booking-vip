import "server-only";

// Outbound notifications of the e-VOA service.
//
// The in-app audit trail (EvoaStatusEvent) is the primary channel — this
// helper adds a WhatsApp push to the pemesan when Twilio is configured,
// using the same REST-over-fetch pattern as src/lib/notify.ts (no SDK).
// Without credentials it degrades to a log line. NEVER throws: a
// notification failure must not roll back a status change.

import { db } from "@/prisma/db";
import { EVOA_STATUS_LABELS } from "@/lib/evoa-shared";
import { isNotifyConfigured } from "@/lib/notify";

/** Normalize an Indonesian-style phone to E.164 (leading 0 → +62). */
function e164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("+")
    ? digits
    : digits.startsWith("0")
      ? `+62${digits.slice(1)}`
      : digits.startsWith("62")
        ? `+${digits}`
        : `+${digits}`;
  return /^\+\d{9,15}$/.test(normalized) ? normalized : null;
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

/**
 * Notify the pemesan about an order status change. Safe to call from any
 * server flow (admin actions, payment webhook hook, customer resubmit).
 */
export async function notifyEvoaStatusChange(
  applicationId: string,
  status: string,
  note?: string,
): Promise<void> {
  try {
    const order = await db.orm.public.VisaApplication
      .select("code", "contactName", "email", "phone")
      .where({ id: applicationId })
      .first();
    if (!order) return;

    if (!isNotifyConfigured()) {
      console.info("[evoa-notify]", order.code, status, "(messaging not configured)");
      return;
    }

    const to = e164(order.phone ?? "");
    if (!to) {
      console.info("[evoa-notify]", order.code, status, "(no usable customer phone)");
      return;
    }

    const label = EVOA_STATUS_LABELS[status]?.id ?? status;
    const name = order.contactName?.trim() || "Kak";
    const body =
      `Halo ${name}! 👋\n` +
      `Pengajuan e-VOA *${order.code}* diperbarui: *${label}*. ✅\n` +
      (note ? `${note}\n` : "") +
      `\nLacak pengajuan: ${appUrl()}/account/visa/${order.code}\n\n` +
      `Tim Booking VIP`;

    const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
    const token = process.env.TWILIO_AUTH_TOKEN!.trim();
    const from = process.env.TWILIO_WHATSAPP_FROM!.trim();
    const waFrom = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: waFrom,
          To: `whatsapp:${to}`,
          Body: body,
        }).toString(),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[evoa-notify] send failed", order.code, response.status, text.slice(0, 300));
      return;
    }
    console.info("[evoa-notify] sent", order.code, status);
  } catch (error) {
    console.error("[evoa-notify] could not send notification", applicationId, status, error);
  }
}
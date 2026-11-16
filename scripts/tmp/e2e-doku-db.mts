// E2E Phase 5 — DB snapshot for the test booking (read-only).
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/e2e-doku-db.mts [code]
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

const code = process.argv[2] ?? "BV-38ZNU9";

const bookings = await db.orm.public.Booking
  .select(
    "id", "code", "status", "serviceAt", "subtotalUsdCents", "addOnsUsdCents",
    "totalUsdCents", "taxUsdCents", "taxes", "currencyCode", "fxRate",
    "invoiceNumber", "pickupLabel", "dropoffLabel", "pickupPolicy",
    "driverOption", "notes", "userId", "createdAt",
  )
  .where((f) => f.code.eq(code))
  .limit(1)
  .all();

const booking = bookings[0];
if (!booking) {
  console.log(JSON.stringify({ error: "booking not found", code }));
  process.exit(1);
}

const payments = await db.orm.public.Payment
  .select(
    "id", "status", "methodId", "amountUsdCents", "currencyCode", "fxRate",
    "provider", "providerRef", "providerAmountCents", "providerCurrency",
    "checkoutUrl", "expiresAt", "paidAt", "createdAt",
  )
  .where((f) => f.bookingId.eq(booking.id))
  .orderBy((f) => f.createdAt.asc())
  .all();

const items = await db.orm.public.BookingItem
  .select("label", "packageLabel", "unitKind", "quantity", "unitUsdCents", "totalUsdCents")
  .where((f) => f.bookingId.eq(booking.id))
  .all();

const events = await db.orm.public.PaymentWebhookEvent
  .select("id", "provider", "providerEventId", "eventType", "outcome", "receivedAt")
  .where((f) => f.provider.eq("doku"))
  .orderBy((f) => f.receivedAt.desc())
  .limit(20)
  .all();

// Keep only events whose payload references our invoice (read payload too).
const ourEvents = [];
for (const e of events) {
  const full = await db.orm.public.PaymentWebhookEvent
    .select("payload")
    .where((f) => f.id.eq(e.id))
    .limit(1)
    .all();
  const payload = JSON.stringify(full[0]?.payload ?? {});
  if (booking.invoiceNumber && payload.includes(booking.invoiceNumber)) {
    ourEvents.push(e);
  }
}

console.log(JSON.stringify({ booking, payments, items, webhookEventsForInvoice: ourEvents }, null, 2));

// Card-fix re-verification — step 5: DB assertions (read-only).
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/cardfix-05-db.mts
import "dotenv/config";
import fs from "node:fs";
import { db } from "../../src/prisma/db.ts";

const state = JSON.parse(
  fs.readFileSync(new URL("./cardfix-state.json", import.meta.url), "utf8"),
);
const code = state.createResult.code;
const invoiceNumber = state.createResult.invoiceNumber;

const bookings = await db.orm.public.Booking
  .select("id", "code", "status", "invoiceNumber", "totalUsdCents", "fxRate")
  .where((f) => f.code.eq(code))
  .limit(1)
  .all();
const booking = bookings[0];
if (!booking) { console.log("FAIL: booking not found"); process.exit(1); }

const payments = await db.orm.public.Payment
  .select("id", "status", "paidAt", "provider", "providerRef", "amountUsdCents",
    "providerAmountCents", "providerCurrency", "fxRate", "checkoutUrl")
  .where((f) => f.bookingId.eq(booking.id))
  .all();
const payment = payments[0];

const events = await db.orm.public.PaymentWebhookEvent
  .select("id", "provider", "providerEventId", "eventType", "outcome", "receivedAt", "payload")
  .where((f) => f.provider.eq("doku"))
  .orderBy((f) => f.receivedAt.desc())
  .limit(30)
  .all();
const ourEvents = events.filter((e) =>
  JSON.stringify(e.payload ?? {}).includes(invoiceNumber),
);

const results = {
  bookingStatusConfirmed: booking.status === "confirmed",
  invoiceMatches: booking.invoiceNumber === invoiceNumber,
  paymentExists: !!payment,
  paymentPaid: payment?.status === "paid",
  paidAtSet: !!payment?.paidAt,
  providerDoku: payment?.provider === "doku",
  providerRefIsInvoice: payment?.providerRef === invoiceNumber,
  checkoutUrlEncodedInDb: !!payment?.checkoutUrl?.includes("%23") && !payment?.checkoutUrl?.includes("#"),
  webhookEventProcessed: ourEvents.some((e) => e.outcome === "processed"),
};

console.log(JSON.stringify({
  booking: { code: booking.code, status: booking.status, invoiceNumber: booking.invoiceNumber },
  payment: payment && {
    status: payment.status, paidAt: payment.paidAt, provider: payment.provider,
    providerRef: payment.providerRef,
    amountUsdCents: payment.amountUsdCents,
    amountIdr: (payment.providerAmountCents ?? 0) / 100,
    providerCurrency: payment.providerCurrency, fxRate: payment.fxRate,
  },
  webhookEventsForInvoice: ourEvents.map((e) => ({
    id: e.id, eventType: e.eventType, outcome: e.outcome, receivedAt: e.receivedAt,
  })),
  results,
}, null, 2));

// Confirmation path: webhook receivedAt vs paidAt.
const ev = ourEvents.find((e) => e.outcome === "processed");
if (ev && payment?.paidAt) {
  const dt = new Date(payment.paidAt).getTime() - new Date(ev.receivedAt).getTime();
  console.log(`confirmation path: webhook (receivedAt ${ev.receivedAt} -> paidAt ${payment.paidAt}, delta ${dt}ms)`);
}

const allPass = Object.values(results).every(Boolean);
console.log(allPass ? "DB ASSERTIONS: ALL PASS" : "DB ASSERTIONS: FAIL");
state.dbResults = results;
fs.writeFileSync(new URL("./cardfix-state.json", import.meta.url), JSON.stringify(state, null, 2));
if (!allPass) process.exit(1);
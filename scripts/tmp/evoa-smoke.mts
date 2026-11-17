#!/usr/bin/env node --experimental-strip-types
// Integration smoke test of the e-VOA order → booking → payment-sync flow.
// Runs against the dev database and cleans up after itself.
//
// Run: node --experimental-strip-types scripts/tmp/evoa-smoke.mts

import "dotenv/config";
import { db } from "../../src/prisma/db.ts";
import { quoteEvoa, getEvoaSettings } from "../../src/lib/evoa-pricing.ts";
import { createEvoaBooking } from "../../src/lib/evoa-booking.ts";
import { applyGatewayEvent } from "../../src/lib/payments.ts";
import { convertUsdCentsToIdr } from "../../src/lib/fx.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures++;
}

const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
const applicationId = crypto.randomUUID();
const code = `SMOKE-${suffix}`;
const arrival = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

async function main() {
  // 0. Clean leftovers of earlier failed runs (SMOKE-* orders).
  const leftovers = await db.orm.public.VisaApplication
    .select("id", "bookingId")
    .where((f) => f.code.like("SMOKE-%"))
    .all();
  for (const row of leftovers) {
    if (row.bookingId) {
      await db.orm.public.Payment.where({ bookingId: row.bookingId }).deleteAll();
      await db.orm.public.BookingItem.where({ bookingId: row.bookingId }).deleteAll();
      await db.orm.public.Contact.where({ bookingId: row.bookingId }).deleteAll();
      await db.orm.public.Traveler.where({ bookingId: row.bookingId }).deleteAll();
      await db.orm.public.Booking.where({ id: row.bookingId }).delete();
    }
    await db.orm.public.VisaApplication.where({ id: row.id }).delete();
  }
  if (leftovers.length) console.log(`cleaned ${leftovers.length} leftover smoke order(s)`);

  // 1. Pricing
  const settings = await getEvoaSettings();
  check("settings loaded", settings.officialFeeIdr === 500000 && settings.maxApplicants === 5, settings);
  const quote = await quoteEvoa(2);
  check("quote total = unit × 2", quote.totalUsdCents === quote.unitUsdCents * 2, quote);
  check("official fee converted", Math.abs(quote.officialFeeUsdCents - Math.round(500000 / quote.rate * 100)) <= 1);

  // 2. Order + applicants
  await db.orm.public.VisaApplication.create({
    id: applicationId,
    code,
    userId: null,
    status: "draft",
    contactName: "Smoke Test",
    email: "smoke@example.com",
    phone: "+6281234567890",
    purpose: "tourism",
    arrivalDate: arrival,
    flightNumber: "GA123",
    hotelName: "Smoke Hotel",
    hotelAddress: "Jl. Smoke 1",
    hotelCity: "Denpasar",
    totalUsdCents: 0,
  });
  for (let i = 0; i < 2; i++) {
    await db.orm.public.VisaApplicant.create({
      id: crypto.randomUUID(),
      applicationId,
      sortOrder: i,
      fullName: `Smoke Person ${i + 1}`,
      gender: i === 0 ? "male" : "female",
      dateOfBirth: new Date("1990-01-01"),
      placeOfBirth: "Singapore",
      nationality: "SG",
      passportNumber: `SMOKE${suffix}${i}`,
      passportType: "ordinary",
      passportIssuingCountry: "SG",
      passportExpiryDate: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
      email: "smoke@example.com",
      phone: "+6281234567890",
      relation: "family",
      status: "pending",
    });
  }

  // 3. Booking creation
  const created = await createEvoaBooking({
    applicationId,
    applicationCode: code,
    userId: null,
    contactName: "Smoke Test",
    email: "smoke@example.com",
    phone: "+6281234567890",
    arrivalDate: arrival,
    applicantNames: ["Smoke Person 1", "Smoke Person 2"],
    quote,
    idempotencyKey: `smoke-${suffix}`,
  });
  check("createEvoaBooking ok", created.ok, created);
  if (!created.ok) throw new Error("booking creation failed");

  const booking = await db.orm.public.Booking.where({ id: created.bookingId }).first();
  check("booking awaiting_payment", booking?.status === "awaiting_payment");
  check("booking total = quote", booking?.totalUsdCents === quote.totalUsdCents);
  const items = await db.orm.public.BookingItem.where({ bookingId: created.bookingId }).all();
  check("two line items (service + official fee)", items.length === 2, items.map((i) => i.label));
  const travelers = await db.orm.public.Traveler.where({ bookingId: created.bookingId }).all();
  check("two travelers", travelers.length === 2);
  const contact = await db.orm.public.Contact.where({ bookingId: created.bookingId }).first();
  check("contact email matches", contact?.email === "smoke@example.com");
  const linked = await db.orm.public.VisaApplication.where({ id: applicationId }).first();
  check("order linked to booking", linked?.bookingId === created.bookingId);
  check("order total synced", linked?.totalUsdCents === quote.totalUsdCents);

  // 4. Idempotency — a second call reuses the booking
  const again = await createEvoaBooking({
    applicationId,
    applicationCode: code,
    userId: null,
    contactName: "Smoke Test",
    email: "smoke@example.com",
    phone: "+6281234567890",
    arrivalDate: arrival,
    applicantNames: ["Smoke Person 1", "Smoke Person 2"],
    quote,
    idempotencyKey: `smoke-${suffix}`,
  });
  check("idempotent reuse", again.ok && again.bookingId === created.bookingId);

  // The submit action flips the order to awaiting_payment once the booking
  // exists — mirror that here so the webhook hook has something to sync.
  await db.orm.public.VisaApplication
    .where({ id: applicationId })
    .update({ status: "awaiting_payment" });

  // 5. Simulate the Xendit paid webhook
  const payment = await db.orm.public.Payment.where({ bookingId: created.bookingId }).first();
  if (!payment) throw new Error("placeholder payment missing");
  const providerRef = `smoke-session-${suffix}`;
  const amountIdr = convertUsdCentsToIdr(quote.totalUsdCents, quote.rate);
  await db.orm.public.Payment.where({ id: payment.id }).update({
    provider: "xendit",
    providerRef,
    providerAmountCents: amountIdr,
    providerCurrency: "IDR",
    fxRate: quote.rate,
  });
  const eventId = `smoke-event-${suffix}`;
  const applied = await applyGatewayEvent({
    provider: "xendit",
    eventId,
    eventType: "payment_session.paid",
    providerRef,
    status: "paid",
    amountCents: amountIdr,
    currency: "IDR",
    raw: { smoke: true },
  });
  check("webhook processed", applied.outcome === "processed", applied);
  const confirmed = await db.orm.public.Booking.where({ id: created.bookingId }).first();
  check("booking confirmed", confirmed?.status === "confirmed");
  const paidOrder = await db.orm.public.VisaApplication.where({ id: applicationId }).first();
  check("visa order synced to paid", paidOrder?.status === "paid" && paidOrder?.paidAt != null, paidOrder?.status);
  const events = await db.orm.public.EvoaStatusEvent.where({ applicationId }).all();
  check("paid audit event written", events.some((e) => e.status === "paid" && e.actor === "system"));

  // 6. Replay dedupe
  const replay = await applyGatewayEvent({
    provider: "xendit",
    eventId,
    eventType: "payment_session.paid",
    providerRef,
    status: "paid",
    amountCents: amountIdr,
    currency: "IDR",
    raw: { smoke: true },
  });
  check("replay ignored", replay.outcome === "ignored", replay);

  // 7. Cleanup — same proven order as step 0 (payments first, booking last;
  // the webhook event has no FK and goes at the very end).
  await db.orm.public.Payment.where({ bookingId: created.bookingId }).deleteAll();
  await db.orm.public.BookingItem.where({ bookingId: created.bookingId }).deleteAll();
  await db.orm.public.Contact.where({ bookingId: created.bookingId }).deleteAll();
  await db.orm.public.Traveler.where({ bookingId: created.bookingId }).deleteAll();
  await db.orm.public.Booking.where({ id: created.bookingId }).delete();
  await db.orm.public.VisaApplication.where({ id: applicationId }).delete();
  await db.orm.public.PaymentWebhookEvent.where({ providerEventId: eventId }).deleteAll();
  const leftover = await db.orm.public.VisaApplicant.where({ applicationId }).all();
  check("cascade cleanup", leftover.length === 0);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
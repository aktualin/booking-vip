// E2E verification of the Xendit webhook path (no card needed):
//   1. create a real Xendit IDR session for a $10 test booking
//   2. store the booking + pending payment rows
//   3. deliver payment_session.completed with the callback token
//   4. assert payment paid + booking confirmed, replay is ignored,
//      and an amount-mismatched event never confirms
//   5. clean up the test rows
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/verify-xendit-webhook.mts
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

const BASE = process.env.WEBHOOK_TEST_URL ?? "http://localhost:3000";
const TOKEN = process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN?.trim();
const KEY = process.env.XENDIT_API_KEY?.trim();
if (!TOKEN || !KEY) throw new Error("XENDIT env not configured");

const ts = Date.now();
const code = `XNDV-${ts}`;
const invoiceNumber = `#INV/TEST/${ts}`;
const bookingId = crypto.randomUUID();
const paymentId = crypto.randomUUID();
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

async function deliver(body: unknown) {
  const res = await fetch(`${BASE}/api/payments/webhook/xendit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-callback-token": TOKEN! },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { ok?: boolean; outcome?: string; error?: string } };
}

try {
  // 1. Live rate + real Xendit session (IDR, cards only).
  const fx = (await (await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR")).json()) as { rates: { IDR: number } };
  const rate = fx.rates.IDR;
  const amountIdr = Math.max(1, Math.round(10 * rate));
  const auth = Buffer.from(`${KEY}:`).toString("base64");
  const sessionRes = await fetch("https://api.xendit.co/sessions", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      reference_id: invoiceNumber.slice(0, 64),
      session_type: "PAY",
      mode: "PAYMENT_LINK",
      amount: amountIdr,
      currency: "IDR",
      country: "ID",
      allow_save_payment_method: "DISABLED",
      allowed_payment_channels: ["CARDS"],
      customer: {
        reference_id: `xndv${ts}`,
        type: "INDIVIDUAL",
        email: "webhook-verify@bookingvip.local",
        individual_detail: { given_names: "Webhook", surname: "Verify" },
      },
      success_return_url: "https://example.com/payment/return?code=" + code,
      failure_return_url: "https://example.com/payment/return?code=" + code + "&status=failed",
    }),
  });
  const session = (await sessionRes.json()) as { payment_session_id?: string; payment_link_url?: string; expires_at?: string; message?: string };
  check("xendit session created (IDR " + amountIdr + ")", Boolean(session.payment_session_id));
  if (!session.payment_session_id) throw new Error(session.message ?? "no session");
  const sessionId = session.payment_session_id;

  // 2. Booking + pending payment rows.
  await db.orm.public.Booking.create({
    id: bookingId, code, status: "awaiting_payment",
    serviceAt: new Date(Date.now() + 86400000),
    adultCount: 1, childCount: 0, infantCount: 0,
    subtotalUsdCents: 1000, addOnsUsdCents: 0, totalUsdCents: 1000,
    invoiceNumber,
  } as never);
  await db.orm.public.Payment.create({
    id: paymentId, bookingId, methodId: null, status: "pending",
    amountUsdCents: 1000, reference: invoiceNumber,
    provider: "xendit", providerRef: sessionId,
    providerAmountCents: amountIdr * 100, providerCurrency: "IDR", fxRate: rate,
    checkoutUrl: session.payment_link_url ?? null,
    expiresAt: session.expires_at ? new Date(session.expires_at) : null,
  } as never);

  // 3. The completion webhook.
  const completed = {
    event: "payment_session.completed",
    business_id: "test",
    created: new Date().toISOString(),
    data: {
      payment_session_id: sessionId,
      reference_id: invoiceNumber,
      status: "COMPLETED",
      amount: amountIdr,
      currency: "IDR",
      payment_request_id: "pr-test",
      payment_id: "py-test",
    },
  };
  const r1 = await deliver(completed);
  check("webhook 200 + processed", r1.status === 200 && r1.json.outcome === "processed");

  const pay = (await db.orm.public.Payment.select("status", "paidAt").where((f) => f.id.eq(paymentId)).all())[0];
  const book = (await db.orm.public.Booking.select("status").where((f) => f.id.eq(bookingId)).all())[0];
  check("payment paid + paidAt set", pay?.status === "paid" && pay?.paidAt != null);
  check("booking confirmed", book?.status === "confirmed");

  // 4. Replay → dedupe ignores it.
  const r2 = await deliver(completed);
  check("replay ignored (dedupe)", r2.status === 200 && r2.json.outcome === "ignored");

  // 5. Amount mismatch never confirms (event recorded as failed).
  const r3 = await deliver({
    event: "payment.capture",
    data: { payment_id: "py-test-2", payment_request_id: "pr-test", reference_id: invoiceNumber, status: "SUCCEEDED", request_amount: amountIdr + 1, currency: "IDR" },
  });
  check("amount mismatch rejected", r3.status === 200 && r3.json.outcome === "failed");

  // 6. Bad token → 401.
  const bad = await fetch(`${BASE}/api/payments/webhook/xendit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-callback-token": "wrong-token" },
    body: JSON.stringify(completed),
  });
  check("bad token 401", bad.status === 401);

  // Cleanup the test rows (ledger events included).
  const eventIds = [
    `payment_session.completed:${sessionId}:COMPLETED`,
    `payment.capture:py-test-2:SUCCEEDED`,
  ];
  for (const eid of eventIds) {
    await db.orm.public.PaymentWebhookEvent.where((f) => f.provider.eq("xendit")).where((f) => f.providerEventId.eq(eid)).deleteAll();
  }
  await db.orm.public.Payment.where((f) => f.id.eq(paymentId)).deleteAll();
  await db.orm.public.Booking.where((f) => f.id.eq(bookingId)).deleteAll();
  console.log("cleanup done");
} catch (err) {
  console.error("ERROR:", err);
  failures++;
} finally {
  await db.close();
}

console.log(failures === 0 ? "XENDIT WEBHOOK E2E: PASS ✅" : `XENDIT WEBHOOK E2E: ${failures} FAIL ❌`);
process.exit(failures === 0 ? 0 : 1);

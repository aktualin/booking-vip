// Temporary webhook verification: a correctly signed notification for an
// unknown invoice must be accepted (outcome "ignored"); a tampered signature
// must be rejected with 401.
// Run: node --experimental-strip-types scripts/tmp/verify-doku-webhook.mts
import "dotenv/config";
import { createHash, createHmac, randomUUID } from "node:crypto";

const base = "http://localhost:3000";
const path = "/api/payments/webhook/doku";
const clientId = process.env.DOKU_BRAND_ID!.trim();
const secret = process.env.DOKU_SECRET_KEY!.trim();

const body = JSON.stringify({
  service: { id: "CREDIT_CARD" },
  acquirer: { id: "BANK_CIMB" },
  channel: { id: "CREDIT_CARD" },
  order: { invoice_number: "TEST-WEBHOOK-UNKNOWN", amount: 10000 },
  transaction: {
    status: "SUCCESS",
    date: new Date().toISOString(),
    original_request_id: randomUUID(),
  },
});

function sign(requestId: string, timestamp: string, raw: string): string {
  const digest = createHash("sha256").update(raw, "utf8").digest("base64");
  const components = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${path}`,
    `Digest:${digest}`,
  ].join("\n");
  return `HMACSHA256=${createHmac("sha256", secret).update(components, "utf8").digest("base64")}`;
}

async function post(label: string, raw: string, fixedRequestId?: string) {
  const requestId = fixedRequestId ?? randomUUID();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      Signature: sign(requestId, timestamp, raw),
    },
    body: raw,
  });
  console.log(label, res.status, await res.text());
}

await post("valid signature  →", body);
await post("replay (same id) →", body, "fixed-replay-id-001");
await post("replay again     →", body, "fixed-replay-id-001");

// Tampered signature.
{
  const requestId = randomUUID();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": timestamp,
      Signature: "HMACSHA256=tampered",
    },
    body,
  });
  console.log("bad signature    →", res.status, await res.text());
}
// Dedupe check: the replayed Request-Id must appear exactly once.
{
  const { db } = await import("../../src/prisma/db.ts");
  const rows = await db.orm.public.PaymentWebhookEvent
    .select("id", "outcome")
    .where((f) => f.provider.eq("doku"))
    .where((f) => f.providerEventId.eq("fixed-replay-id-001"))
    .all();
  console.log("dedupe rows      →", rows.length, JSON.stringify(rows));
}
process.exit(0);
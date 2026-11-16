// Probe: is the Host-to-Host Check 3DS endpoint available for this sandbox
// account? If yes, the card form can live on OUR page (H2H flow) without
// waiting for DOKU JS activation.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/probe-doku-h2h.mts
import "dotenv/config";
import { createHash, createHmac, randomUUID } from "node:crypto";

const clientId = process.env.DOKU_BRAND_ID!.trim();
const secret = process.env.DOKU_SECRET_KEY!.trim();
const base = "https://api-sandbox.doku.com";
const path = "/credit-card/check-three-d-secure";

const body = JSON.stringify({
  customer: {
    name: "Probe H2H",
    email: "probe-h2h@example.com",
    phone: "081234567890",
    country: "ID",
  },
  order: {
    amount: 10000,
    invoice_number: "PROBE-H2H-" + Date.now(),
  },
  card: {
    number: "4617006911111106",
    expiry: "0131",
  },
  payment: { type: "SALE" },
  three_dsecure: {
    callback_url_success: "https://example.com/3ds-success",
    callback_url_failed: "https://example.com/3ds-failed",
  },
});

const requestId = randomUUID();
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const digest = createHash("sha256").update(body, "utf8").digest("base64");
const components = [
  `Client-Id:${clientId}`,
  `Request-Id:${requestId}`,
  `Request-Timestamp:${timestamp}`,
  `Request-Target:${path}`,
  `Digest:${digest}`,
].join("\n");
const signature = `HMACSHA256=${createHmac("sha256", secret).update(components, "utf8").digest("base64")}`;

const res = await fetch(base + path, {
  method: "POST",
  headers: {
    "Client-Id": clientId,
    "Request-Id": requestId,
    "Request-Timestamp": timestamp,
    Signature: signature,
    "Content-Type": "application/json",
  },
  body,
  cache: "no-store",
});

const text = await res.text();
console.log("HTTP", res.status);
console.log("body:", text.slice(0, 600));
process.exit(0);
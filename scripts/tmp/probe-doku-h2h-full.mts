// Full H2H chain probe: Check 3DS → complete 3DS in a browser → Charge.
// If the charge returns payment.status SUCCESS, the embedded card form on our
// site is viable via Host-to-Host (no DOKU JS activation needed).
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/probe-doku-h2h-full.mts
import "dotenv/config";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");

const clientId = process.env.DOKU_BRAND_ID!.trim();
const secret = process.env.DOKU_SECRET_KEY!.trim();
const base = "https://api-sandbox.doku.com";

async function dokuPost<T>(path: string, body: unknown): Promise<T> {
  const bodyText = JSON.stringify(body);
  const requestId = randomUUID();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const digest = createHash("sha256").update(bodyText, "utf8").digest("base64");
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
    body: bodyText,
    cache: "no-store",
  });
  const text = await res.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* raw */ }
  return { status: res.status, payload } as unknown as T;
}

const invoice = "PROBE-H2H-FULL-" + Date.now();
const customer = { name: "Probe Full", email: "probe-full@example.com", phone: "081234567890", country: "ID" };

// 1. Check 3DS
const check = await dokuPost<{ status: number; payload: any }>(
  "/credit-card/check-three-d-secure",
  {
    customer,
    order: { amount: 10000, invoice_number: invoice },
    card: { number: "4617006911111106", expiry: "0131" },
    payment: { type: "SALE" },
    three_dsecure: {
      callback_url_success: "https://example.com/3ds-success",
      callback_url_failed: "https://example.com/3ds-failed",
    },
  },
);
const auth = check.payload?.three_dsecure;
console.log("1. CHECK 3DS http", check.status, "| auth_id:", auth?.authentication_id?.slice(0, 24) + "…");
if (!auth?.authentication_id) { console.log("FAILED at check-3ds:", JSON.stringify(check.payload)); process.exit(1); }

// 2. Complete 3DS in a real browser
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(auth.authentication_url, { waitUntil: "domcontentloaded", timeout: 60000 });
console.log("2. 3DS page loaded:", page.url().slice(0, 70) + "…");
try {
  await page.waitForSelector("input", { timeout: 15000 });
  const bodyText = await page.evaluate(() => document.body.innerText);
  const otpHint = bodyText.match(/\(OTP:\s*(\d+)\)/i)?.[1];
  console.log("   OTP hint on page:", otpHint ?? "(none — will try 1234)");
  const input = page.locator("input").first();
  await input.fill(otpHint ?? "1234");
  const submit = page.getByRole("button").first();
  await submit.click();
  await page.waitForURL(/3ds-success|3ds-failed|example\.com/, { timeout: 30000 }).catch(() => {});
  console.log("   after OTP submit →", page.url().slice(0, 80));
} catch (e) {
  console.log("   3DS page note:", (e as Error).message.slice(0, 100));
}
await page.screenshot({ path: "scripts/tmp/probe-h2h-3ds.png", fullPage: true });
await browser.close();

// 3. Charge
const charge = await dokuPost<{ status: number; payload: any }>(
  "/credit-card/charge",
  {
    order: { amount: 10000, invoice_number: invoice },
    customer,
    three_dsecure: { authentication_id: auth.authentication_id },
    payment: { type: "SALE" },
    card: { cvv: "123", save: false },
  },
);
const p = charge.payload?.payment;
console.log("3. CHARGE http", charge.status, "| payment.status:", p?.status, "| response_code:", p?.response_code, "| message:", p?.response_message);
console.log("   card:", JSON.stringify(charge.payload?.card));
console.log(p?.status === "SUCCESS" ? "\nH2H FULL CHAIN: PASS ✅" : "\nH2H FULL CHAIN: check response above");
process.exit(0);
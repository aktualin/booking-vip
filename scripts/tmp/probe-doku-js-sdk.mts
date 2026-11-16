// Empirically test DOKU JS SDK in sandbox: does collectCardData work with a
// simulator-style generated session_id (ps_sandbox_...), without the
// payment-page API returning credit_card_js? Mirrors the official doc example.
// Run: node --experimental-strip-types scripts/tmp/probe-doku-js-sdk.mts
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const html = `<!DOCTYPE html><html><head>
<script src="https://sandbox.doku.com/card-session/card-session-2.0.0.js"></script>
</head><body>
<form id="f">
<input id="cardNumber"/><input id="expiryMonth"/><input id="expiryYear"/><input id="cvv"/>
<input id="firstName"/><input id="lastName"/>
</form></body></html>`;

await page.setContent(html, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => !!(window as any).PG, { timeout: 30000 });
console.log("SDK loaded, PG present:", await page.evaluate(() => !!(window as any).PG));

const sessionId = `ps_sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
console.log("generated session_id:", sessionId);

const result = await page.evaluate(async (sid) => {
  const PG = (window as any).PG;
  try { PG.init({ fields: { cardNumber: "cardNumber", expiryMonth: "expiryMonth", expiryYear: "expiryYear", cvv: "cvv" } }); }
  catch (e) { return { stage: "init", error: String(e) }; }
  // Fill the bound DOM inputs first — the SDK validates through them.
  const set = (id: string, v: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
  };
  set("cardNumber", "4617006911111106");
  set("expiryMonth", "01");
  set("expiryYear", "31");
  set("cvv", "123");
  const cardData = {
    session_id: sid,
    card_number: "4617006911111106",
    expiry_month: "01", expiry_year: "31", cvv: "123",
    card_holder_first_name: "John", card_holder_last_name: "Doe",
    card_holder_email: "john.doe@example.com",
  };
  return await new Promise((resolve) => {
    try {
      PG.payment.collectCardData(cardData, (error: any, response: any) => {
        resolve({ stage: "callback", error: error ? { message: error.message, raw: error } : null, response });
      });
    } catch (e) { resolve({ stage: "call", error: String(e) }); }
    setTimeout(() => resolve({ stage: "timeout", note: "no callback in 25s" }), 25000);
  });
}, sessionId);

console.log("RESULT:", JSON.stringify(result, null, 2));
await browser.close();
process.exit(0);
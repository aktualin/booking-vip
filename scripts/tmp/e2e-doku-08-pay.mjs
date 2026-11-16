// E2E Phase 5 — step 4: REAL payment on DOKU's hosted sandbox card page.
// Replicates PaymentStep: set localStorage on the app origin, then go to the
// gateway. The ONLY deviation: '#' in the returned URL is percent-encoded to
// '%23' (workaround for the unencoded-'#' bug — reported, not fixed in source).
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const state = JSON.parse(
  fs.readFileSync(new URL("./e2e-doku-state.json", import.meta.url), "utf8"),
);
const code = state.createResult.code;
const email = "e2e-doku@example.com";
const APP = "https://aa88d59a543de5.app.lhr.life";
const checkoutUrl = state.startResult.checkoutUrl.replace("#", "%23");

const CARD = "4617006911111106"; // VISA, 3DS Success (DOKU simulator)
const EXPIRY = "0131"; // 01 / (2026+5 -> 31)
const CVV = "123";
const OTP = "999999";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

// 1) Establish the app origin + localStorage exactly like PaymentStep does.
await page.goto(APP + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.evaluate(
  ([k, v]) => localStorage.setItem(k, v),
  ["booking-vip:last-booking", JSON.stringify({ code, email })],
);
console.log("localStorage set on", APP);

// 2) Open the DOKU hosted card page.
await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#card-number", { state: "visible", timeout: 45000 });
console.log("card form visible");

// 3) Fill the sandbox test card.
await page.locator("#card-number").pressSequentially(CARD, { delay: 40 });
await page.locator("#expiry").pressSequentially(EXPIRY, { delay: 60 });
await page.locator("#cvv").fill(CVV);
await page.waitForTimeout(500);
console.log("card value:", await page.locator("#card-number").inputValue());
console.log("expiry value:", await page.locator("#expiry").inputValue());
await page.screenshot({ path: "scripts/tmp/e2e-doku-05-card-form.png", fullPage: true });

// 4) Submit.
await page.getByRole("button", { name: /pay now/i }).click();
console.log("clicked Pay Now");

// 5) Handle 3DS / OTP across frames, then wait for the redirect.
const deadline = Date.now() + 90000;
let otpDone = false;
let redirected = false;
let shot3ds = false;
while (Date.now() < deadline) {
  if (page.url().includes("/payment/return")) { redirected = true; break; }

  // Look for an OTP challenge in any frame.
  for (const frame of page.frames()) {
    try {
      const otpSel = await frame.evaluate(() => {
        const cand =
          document.querySelector("#otp") ||
          document.querySelector('input[name="otp"]') ||
          document.querySelector('input[formcontrolname="otp"]') ||
          [...document.querySelectorAll("input")].find((i) =>
            /otp|verification|challenge/i.test(i.placeholder || i.name || i.id || ""),
          );
        if (!cand) return null;
        return { id: cand.id, name: cand.name, tag: cand.tagName };
      });
      if (otpSel) {
        if (!shot3ds) {
          await page.screenshot({ path: "scripts/tmp/e2e-doku-06-3ds.png", fullPage: true });
          shot3ds = true;
          console.log("3DS frame URL:", frame.url().slice(0, 140));
        }
        const loc = frame.locator(
          otpSel.id ? `#${otpSel.id}` : otpSel.name ? `input[name="${otpSel.name}"]` : "input",
        );
        await loc.fill(OTP);
        // Find a submit-ish button in the same frame.
        const btn = frame.locator(
          'button[type=submit], input[type=submit], button:has-text("Submit"), button:has-text("Verify"), button:has-text("OK"), button:has-text("Continue"), button:has-text("Next"), button:has-text("Confirm")',
        ).first();
        if (await btn.count()) { await btn.click(); console.log("OTP submitted"); }
        else { await loc.press("Enter"); console.log("OTP entered (Enter)"); }
        otpDone = true;
        await page.waitForTimeout(3000);
        break;
      }
    } catch {}
  }
  await page.waitForTimeout(1500);
}
console.log("redirected:", redirected, "otpDone:", otpDone, "URL:", page.url());

if (!redirected) {
  // Dump what we're stuck on for diagnosis.
  await page.screenshot({ path: "scripts/tmp/e2e-doku-06-stuck.png", fullPage: true });
  for (const f of page.frames()) {
    try { console.log("FRAME", f.url().slice(0, 120), "::", (await f.evaluate(() => document.body.innerText)).slice(0, 300)); } catch {}
  }
  await browser.close();
  process.exit(2);
}

// 6) Return page — auto-loads email from localStorage, polls until paid.
await page.waitForLoadState("domcontentloaded");
// If the email form appears (localStorage not picked up), fill it.
const emailInput = page.locator('input[type="email"]');
if (await emailInput.count()) {
  await emailInput.fill(email);
  await page.getByRole("button", { name: /periksa/i }).click();
  console.log("submitted email on return page");
}

const paidDeadline = Date.now() + 95000;
let paid = false;
while (Date.now() < paidDeadline) {
  const txt = await page.evaluate(() => document.body.innerText);
  if (txt.includes("Pembayaran berhasil")) { paid = true; break; }
  if (txt.includes("Pembayaran belum selesai")) { console.log("RETURN: failed state"); break; }
  await page.waitForTimeout(3000);
}
console.log("return page paid:", paid);
await page.screenshot({ path: "scripts/tmp/e2e-doku-07-return-paid.png", fullPage: true });
console.log("return body:", (await page.evaluate(() => document.body.innerText)).slice(0, 400));

state.payment = { redirected, otpDone, paid, finalUrl: page.url() };
fs.writeFileSync(new URL("./e2e-doku-state.json", import.meta.url), JSON.stringify(state, null, 2));
await browser.close();

// E2E Phase 5 — step 4 (resume): complete the 3DS challenge.
// The card was submitted; DOKU is at the cybersource-otp simulator which
// displays the OTP to use. Re-open the checkout URL and finish the flow.
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
const CARD = "4617006911111106";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(APP + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.evaluate(
  ([k, v]) => localStorage.setItem(k, v),
  ["booking-vip:last-booking", JSON.stringify({ code, email })],
);

await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(10000);
console.log("URL after load:", page.url());

const dump = async (label) => {
  console.log("=====", label, "=====");
  for (const f of page.frames()) {
    try {
      const info = await f.evaluate(() => ({
        url: location.href.slice(0, 130),
        inputs: [...document.querySelectorAll("input,select")].map((el) => ({
          type: el.type, id: el.id || undefined, name: el.name || undefined,
          placeholder: el.placeholder || undefined, fcn: el.getAttribute("formcontrolname") || undefined,
          visible: !!(el.offsetWidth || el.offsetHeight),
        })),
        buttons: [...document.querySelectorAll("button,[role=button],input[type=submit]")].map((el) => ({
          tag: el.tagName, id: el.id || undefined, type: el.type || undefined,
          text: (el.textContent || el.value || "").trim().slice(0, 50),
          visible: !!(el.offsetWidth || el.offsetHeight),
        })),
        text: document.body.innerText.slice(0, 500),
      }));
      if (info.inputs.length || info.buttons.length || info.text.trim())
        console.log(JSON.stringify(info, null, 1));
    } catch {}
  }
};

await dump("initial state");

// If the card form is shown again, fill + submit.
if (await page.locator("#card-number").count()) {
  await page.locator("#card-number").pressSequentially(CARD, { delay: 30 });
  await page.locator("#expiry").pressSequentially("0131", { delay: 50 });
  await page.locator("#cvv").fill("123");
  await page.screenshot({ path: "scripts/tmp/e2e-doku-05-card-form.png", fullPage: true });
  await page.getByRole("button", { name: /pay now/i }).click();
  console.log("re-submitted card");
  await page.waitForTimeout(8000);
  await dump("after card submit");
}

// Complete the OTP challenge (any visible non-hidden input on the OTP page).
const deadline = Date.now() + 60000;
let otpDone = false;
while (Date.now() < deadline && !otpDone) {
  if (page.url().includes("/payment/return")) break;
  for (const frame of page.frames()) {
    try {
      const challenge = await frame.evaluate(() => {
        const text = document.body.innerText;
        if (!/OTP|Authentication|code/i.test(text)) return null;
        const input = [...document.querySelectorAll("input")].find(
          (i) => i.type !== "hidden" && (i.offsetWidth || i.offsetHeight),
        );
        if (!input) return null;
        const m = text.match(/\(OTP:\s*(\d+)\)/);
        return { otp: m ? m[1] : null, sel: input.id ? `#${input.id}` : input.name ? `input[name="${input.name}"]` : null, type: input.type };
      });
      if (challenge) {
        console.log("challenge found:", JSON.stringify(challenge), "frame:", frame.url().slice(0, 120));
        await page.screenshot({ path: "scripts/tmp/e2e-doku-06-3ds.png", fullPage: true });
        const otp = challenge.otp || "1234";
        const loc = challenge.sel ? frame.locator(challenge.sel) : frame.locator('input:not([type=hidden])').first();
        await loc.fill(otp);
        const submit = frame.locator('button:has-text("SUBMIT"), button:has-text("Submit"), button[type=submit], input[type=submit]').first();
        if (await submit.count()) await submit.click();
        else await loc.press("Enter");
        console.log("OTP", otp, "submitted");
        otpDone = true;
        break;
      }
    } catch {}
  }
  await page.waitForTimeout(2000);
}

// Wait for the redirect back to the app.
const redirDeadline = Date.now() + 60000;
while (Date.now() < redirDeadline && !page.url().includes("/payment/return")) {
  await page.waitForTimeout(2000);
}
console.log("final URL:", page.url());

if (!page.url().includes("/payment/return")) {
  await dump("stuck state");
  await page.screenshot({ path: "scripts/tmp/e2e-doku-06-stuck.png", fullPage: true });
  await browser.close();
  process.exit(2);
}

// Return page: poll until paid.
await page.waitForLoadState("domcontentloaded");
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
  if (txt.includes("Pembayaran belum selesai")) break;
  await page.waitForTimeout(3000);
}
console.log("return page paid:", paid);
await page.screenshot({ path: "scripts/tmp/e2e-doku-07-return-paid.png", fullPage: true });
console.log("return body:", (await page.evaluate(() => document.body.innerText)).slice(0, 400));

state.payment = { otpDone, paid, finalUrl: page.url() };
fs.writeFileSync(new URL("./e2e-doku-state.json", import.meta.url), JSON.stringify(state, null, 2));
await browser.close();

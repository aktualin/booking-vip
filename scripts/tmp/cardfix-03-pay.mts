// Card-fix re-verification — steps 3+4: REAL card payment on DOKU's hosted
// sandbox page. The checkoutUrl is opened EXACTLY AS RETURNED by the server
// action — no encoding, no editing, no workaround.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/cardfix-03-pay.mts
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");

const state = JSON.parse(
  fs.readFileSync(new URL("./cardfix-state.json", import.meta.url), "utf8"),
);
const code = state.createResult.code;
const invoiceNumber = state.createResult.invoiceNumber;
const email = "card-fix@example.com";
const APP = "https://aa88d59a543de5.app.lhr.life";
// NO transformation — this is the whole point of the re-verification.
const checkoutUrl: string = state.startResult.checkoutUrl;
if (checkoutUrl.includes("#")) {
  console.log("ABORT: raw '#' in URL — fix already failed at step 2.");
  process.exit(1);
}

const CARD = "4617006911111106"; // VISA, 3DS Success (DOKU sandbox simulator)
const EXPIRY = "0131"; // 01/31
const CVV = "123";
const OTP_PRIMARY = "1234";
const OTP_FALLBACK = "999999"; // previous successful run used this

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200));
});

// Capture DOKU API POSTs for diagnosis (previous bug: invoice_number:"" to
// /credit-card/duplicate because the '#' became a URL fragment).
const dokuPosts: Array<{ url: string; body: string | null }> = [];
page.on("request", (req) => {
  try {
    if (req.method() === "POST" && /doku\.com/.test(req.url())) {
      dokuPosts.push({ url: req.url(), body: req.postData() });
    }
  } catch {}
});

// 1) Establish the app origin + localStorage exactly like PaymentStep does
//    (normal app behavior — NOT a URL workaround).
await page.goto(APP + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.evaluate(
  ([k, v]) => localStorage.setItem(k, v),
  ["booking-vip:last-booking", JSON.stringify({ code, email })],
);
console.log("localStorage set on", APP);

// 2) Open the DOKU hosted card page EXACTLY as returned.
console.log("goto:", checkoutUrl);
await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

let formVisible = false;
try {
  await page.waitForSelector("#card-number", { state: "visible", timeout: 45000 });
  formVisible = true;
} catch {}

const bodyTextNow = await page.evaluate(() => document.body.innerText).catch(() => "");
const stuckOnPleaseWait = /please wait/i.test(bodyTextNow) && !formVisible;
console.log("card form visible:", formVisible, "| stuck on 'Please Wait':", stuckOnPleaseWait);
console.log("page URL after load:", page.url());
await page.screenshot({ path: "scripts/tmp/cardfix-01-form.png", fullPage: true });

if (!formVisible) {
  console.log("FAIL: card form did not load.");
  console.log("BODY:", bodyTextNow.slice(0, 500));
  for (const f of page.frames()) {
    try {
      console.log("FRAME", f.url().slice(0, 140), "::", (await f.evaluate(() => document.body.innerText)).slice(0, 300));
    } catch {}
  }
  console.log("DOKU POSTs captured:", JSON.stringify(dokuPosts, null, 2));
  fs.writeFileSync(
    new URL("./cardfix-state.json", import.meta.url),
    JSON.stringify({ ...state, payment: { formVisible, stuckOnPleaseWait, dokuPosts } }, null, 2),
  );
  await browser.close();
  process.exit(2);
}

// Assert the expected card fields / button are present.
const hasExpiry = (await page.locator("#expiry").count()) > 0;
const hasCvv = (await page.locator("#cvv").count()) > 0;
const payNowBtn = page.getByRole("button", { name: /pay now/i });
const hasPayNow = (await payNowBtn.count()) > 0;
console.log("fields: expiry:", hasExpiry, "cvv:", hasCvv, "payNow:", hasPayNow);

// 3) Fill the sandbox test card.
await page.locator("#card-number").pressSequentially(CARD, { delay: 40 });
await page.locator("#expiry").pressSequentially(EXPIRY, { delay: 60 });
await page.locator("#cvv").fill(CVV);
await page.waitForTimeout(500);
console.log("card value:", await page.locator("#card-number").inputValue());
console.log("expiry value:", await page.locator("#expiry").inputValue());
await page.screenshot({ path: "scripts/tmp/cardfix-01-form.png", fullPage: true });

// 4) Submit.
await payNowBtn.first().click();
console.log("clicked Pay Now");

// 5) Handle 3DS / OTP across frames, then wait for the redirect.
const deadline = Date.now() + 90000;
let otpDone = false;
let otpUsed: string | null = null;
let redirected = false;
let shot3ds = false;
let triedFallback = false;
while (Date.now() < deadline) {
  if (page.url().includes("/payment/return")) { redirected = true; break; }

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
          await page.screenshot({ path: "scripts/tmp/cardfix-04-3ds.png", fullPage: true });
          shot3ds = true;
          console.log("3DS frame URL:", frame.url().slice(0, 140));
        }
        const otp = otpDone && !triedFallback ? OTP_FALLBACK : OTP_PRIMARY;
        if (otpDone) triedFallback = true;
        const loc = frame.locator(
          otpSel.id ? `#${otpSel.id}` : otpSel.name ? `input[name="${otpSel.name}"]` : "input",
        );
        await loc.fill(otp);
        const btn = frame.locator(
          'button[type=submit], input[type=submit], button:has-text("Submit"), button:has-text("Verify"), button:has-text("OK"), button:has-text("Continue"), button:has-text("Next"), button:has-text("Confirm")',
        ).first();
        if (await btn.count()) { await btn.click(); console.log("OTP submitted:", otp); }
        else { await loc.press("Enter"); console.log("OTP entered (Enter):", otp); }
        otpDone = true;
        otpUsed = otp;
        await page.waitForTimeout(3000);
        break;
      }
    } catch {}
  }
  await page.waitForTimeout(1500);
}
console.log("redirected:", redirected, "otpDone:", otpDone, "otpUsed:", otpUsed, "URL:", page.url());

if (!redirected) {
  await page.screenshot({ path: "scripts/tmp/cardfix-05-stuck.png", fullPage: true });
  for (const f of page.frames()) {
    try { console.log("FRAME", f.url().slice(0, 140), "::", (await f.evaluate(() => document.body.innerText)).slice(0, 300)); } catch {}
  }
  console.log("DOKU POSTs captured:", JSON.stringify(dokuPosts, null, 2));
  fs.writeFileSync(
    new URL("./cardfix-state.json", import.meta.url),
    JSON.stringify({ ...state, payment: { formVisible, redirected, otpDone, otpUsed, dokuPosts } }, null, 2),
  );
  await browser.close();
  process.exit(2);
}

// 6) Return page — auto-loads email from localStorage, polls until paid.
await page.waitForLoadState("domcontentloaded");
const emailInput = page.locator('input[type="email"]');
if (await emailInput.count()) {
  await emailInput.fill(email);
  await page.evaluate(() => {
    const input = document.querySelector('input[type="email"]');
    (input as HTMLInputElement | null)?.closest("form")?.requestSubmit();
  });
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
await page.screenshot({ path: "scripts/tmp/cardfix-02-return.png", fullPage: true });
console.log("return body:", (await page.evaluate(() => document.body.innerText)).slice(0, 400));

// Report what DOKU POSTs carried the invoice (proof the hosted page got it).
const dupPosts = dokuPosts.filter((p) => /duplicate|payment|charge|auth/i.test(p.url));
console.log("DOKU POST count:", dokuPosts.length);
for (const p of dupPosts.slice(0, 12)) {
  console.log("POST", p.url.slice(0, 120), "body:", (p.body ?? "").slice(0, 300));
}

state.payment = {
  formVisible, stuckOnPleaseWait, hasExpiry, hasCvv, hasPayNow,
  redirected, otpDone, otpUsed, paid, finalUrl: page.url(),
  dokuPostCount: dokuPosts.length,
  dokuPosts: dokuPosts.slice(0, 20),
};
fs.writeFileSync(new URL("./cardfix-state.json", import.meta.url), JSON.stringify(state, null, 2));
await browser.close();
if (!paid) process.exit(3);
console.log("PAYMENT FLOW: PASS");
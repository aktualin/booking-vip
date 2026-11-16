// Card-fix re-verification — steps 3+4 (resume): the card was submitted and
// DOKU is at the cybersource-otp simulator ("Purchase Authentication", which
// displays the OTP to use). Re-open the SAME checkout URL — exactly as the
// server returned it, still no transformation — and finish the flow.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/cardfix-04-resume.mts
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");

const state = JSON.parse(
  fs.readFileSync(new URL("./cardfix-state.json", import.meta.url), "utf8"),
);
const code = state.createResult.code;
const email = "card-fix@example.com";
const APP = "https://aa88d59a543de5.app.lhr.life";
const checkoutUrl: string = state.startResult.checkoutUrl; // EXACTLY as returned
if (checkoutUrl.includes("#")) { console.log("ABORT: raw '#' present"); process.exit(1); }
const CARD = "4617006911111106";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

const dokuPosts: Array<{ url: string; body: string | null }> = [];
page.on("request", (req) => {
  try {
    if (req.method() === "POST" && /doku\.com/.test(req.url()) && !/\/collect\?/.test(req.url())) {
      dokuPosts.push({ url: req.url(), body: req.postData() });
    }
  } catch {}
});

await page.goto(APP + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.evaluate(
  ([k, v]) => localStorage.setItem(k, v),
  ["booking-vip:last-booking", JSON.stringify({ code, email })],
);

console.log("goto (as returned):", checkoutUrl);
await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(10000);
console.log("URL after load:", page.url());

const dump = async (label: string) => {
  console.log("=====", label, "=====");
  for (const f of page.frames()) {
    try {
      const info = await f.evaluate(() => ({
        url: location.href.slice(0, 130),
        inputs: [...document.querySelectorAll("input,select")].map((el: any) => ({
          type: el.type, id: el.id || undefined, name: el.name || undefined,
          placeholder: el.placeholder || undefined,
          visible: !!(el.offsetWidth || el.offsetHeight),
        })),
        buttons: [...document.querySelectorAll("button,[role=button],input[type=submit]")].map((el: any) => ({
          tag: el.tagName, type: el.type || undefined,
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
  await page.screenshot({ path: "scripts/tmp/cardfix-01-form.png", fullPage: true });
  await page.getByRole("button", { name: /pay now/i }).click();
  console.log("re-submitted card");
  await page.waitForTimeout(8000);
  await dump("after card submit");
}

// Complete the OTP challenge: detect by page text + any visible input, and
// read the OTP the simulator itself displays ("(OTP: 1234)").
const deadline = Date.now() + 90000;
let otpDone = false;
let otpUsed: string | null = null;
let shot3ds = false;
while (Date.now() < deadline && !otpDone) {
  if (page.url().includes("/payment/return")) break;
  for (const frame of page.frames()) {
    try {
      const challenge = await frame.evaluate(() => {
        const text = document.body.innerText;
        if (!/OTP|Authentication|code/i.test(text)) return null;
        const input = [...document.querySelectorAll("input")].find(
          (i: any) => i.type !== "hidden" && (i.offsetWidth || i.offsetHeight),
        );
        if (!input) return null;
        const m = text.match(/\(OTP:\s*(\d+)\)/);
        return {
          otp: m ? m[1] : null,
          sel: (input as any).id ? `#${(input as any).id}` : (input as any).name ? `input[name="${(input as any).name}"]` : null,
          type: (input as any).type,
        };
      });
      if (challenge) {
        console.log("challenge found:", JSON.stringify(challenge), "frame:", frame.url().slice(0, 120));
        if (!shot3ds) {
          await page.screenshot({ path: "scripts/tmp/cardfix-04-3ds.png", fullPage: true });
          shot3ds = true;
        }
        const otp = challenge.otp || "1234";
        const loc = challenge.sel ? frame.locator(challenge.sel) : frame.locator("input:not([type=hidden])").first();
        await loc.fill(otp);
        const submit = frame.locator('button:has-text("SUBMIT"), button:has-text("Submit"), button[type=submit], input[type=submit]').first();
        if (await submit.count()) await submit.click();
        else await loc.press("Enter");
        console.log("OTP", otp, "submitted");
        otpDone = true;
        otpUsed = otp;
        break;
      }
    } catch {}
  }
  await page.waitForTimeout(2000);
}

// Wait for the redirect back to the app.
const redirDeadline = Date.now() + 90000;
while (Date.now() < redirDeadline && !page.url().includes("/payment/return")) {
  await page.waitForTimeout(2000);
}
console.log("final URL:", page.url(), "| otpDone:", otpDone, "otpUsed:", otpUsed);

if (!page.url().includes("/payment/return")) {
  await dump("stuck state");
  await page.screenshot({ path: "scripts/tmp/cardfix-05-stuck.png", fullPage: true });
  console.log("DOKU POSTs:", JSON.stringify(dokuPosts, null, 2));
  state.payment = { ...(state.payment ?? {}), otpDone, otpUsed, redirected: false, dokuPosts };
  fs.writeFileSync(new URL("./cardfix-state.json", import.meta.url), JSON.stringify(state, null, 2));
  await browser.close();
  process.exit(2);
}

// Return page: poll until paid.
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

console.log("DOKU POST count:", dokuPosts.length);
for (const p of dokuPosts.slice(0, 12)) {
  console.log("POST", p.url.slice(0, 120), "body:", (p.body ?? "").slice(0, 220));
}

state.payment = {
  ...(state.payment ?? {}),
  resumed: true, otpDone, otpUsed, redirected: true, paid,
  finalUrl: page.url(), dokuPosts,
};
fs.writeFileSync(new URL("./cardfix-state.json", import.meta.url), JSON.stringify(state, null, 2));
await browser.close();
if (!paid) process.exit(3);
console.log("PAYMENT FLOW: PASS");
// Load the encoded DOKU payment page in a real browser and confirm the card
// form renders (the unencoded '#' used to hang it on "Please Wait"). Also
// load the public invoice page and capture any console prerender warning.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/verify-browser.mts
import { createRequire } from "node:module";
import "dotenv/config";
import { createCardPaymentPage } from "../../src/lib/doku.ts";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");

const invoice = "#INV/2026/11/16/9998/YY";
const res = await createCardPaymentPage({
  invoiceNumber: invoice,
  amountIdr: 10000,
  payerEmail: "browser-check@example.com",
  description: "Browser load verification",
  successRedirectUrl: "https://aa88d59a543de5.app.lhr.life/payment/return?code=TEST",
  failureRedirectUrl: "https://aa88d59a543de5.app.lhr.life/payment/return?code=TEST&status=failed",
});

const browser = await chromium.launch();
const page = await browser.newPage();

// 1. DOKU hosted card page with the encoded URL.
await page.goto(res.checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);
const body = await page.evaluate(() => document.body.innerText);
const stuck = /please wait/i.test(body) && !/card number|nomor kartu|credit card/i.test(body);
const hasCardField = await page.locator('input[name*="card" i], input[placeholder*="card" i], input[inputmode="numeric"]').count();
await page.screenshot({ path: "scripts/tmp/fix-card-page.png", fullPage: true });
console.log("DOKU page stuck on 'Please Wait':", stuck, "(want false)");
console.log("card-ish input fields found:", hasCardField);
console.log("page text sample:", body.replace(/\s+/g, " ").slice(0, 160));

// 2. Public invoice page — watch for the prerender console warning.
const warnings = [];
page.on("console", (m) => { if (/prerender|Suspense/i.test(m.text())) warnings.push(m.text()); });
await page.goto("http://localhost:3000/invoice/BV-38ZNU9", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: "scripts/tmp/fix-invoice-page.png", fullPage: true });
console.log("invoice prerender/Suspense console warnings:", warnings.length, "(want 0)");

await browser.close();
console.log(!stuck && warnings.length === 0 ? "PASS" : "CHECK");
process.exit(0);
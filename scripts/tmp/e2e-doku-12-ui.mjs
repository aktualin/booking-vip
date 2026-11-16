// E2E Phase 5 — steps 4/6/7 UI verification with Playwright.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const state = JSON.parse(fs.readFileSync(new URL("./e2e-doku-state.json", import.meta.url), "utf8"));
const code = state.createResult.code;
const invoiceNumber = state.createResult.invoiceNumber;
const email = "e2e-doku@example.com";
const BASE = "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const results = {};

async function bodyText(page) {
  try { return (await page.locator("body").innerText({ timeout: 3000 })) ?? ""; }
  catch { return ""; }
}
const norm = (s) => s.replace(/\u00a0/g, " ");
async function submitEmailForm(page, address) {
  const inp = page.locator('input[type="email"]');
  await inp.fill(address);
  await page.waitForTimeout(300);
  // Submit the form that owns the email input (the header also has a search form).
  await page.evaluate(() => {
    const input = document.querySelector('input[type="email"]');
    input?.closest("form")?.requestSubmit();
  });
}
async function waitForText(page, text, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (norm(await bodyText(page)).includes(text)) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

/* A — return page shows "Pembayaran berhasil" (email-form path). */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/payment/return?code=${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const em = page.locator('input[type="email"]');
  if (await em.count()) {
    await submitEmailForm(page, email);
  }
  const paid = await waitForText(page, "Pembayaran berhasil", 30000);
  const txt = norm(await bodyText(page));
  results.returnPage = {
    paid,
    hasInvoiceLink: txt.includes("Lihat invoice"),
    showsCode: txt.includes(code),
  };
  await page.screenshot({ path: "scripts/tmp/e2e-doku-07-return-paid.png", fullPage: true });
  await ctx.close();
}

/* B — invoice via email form (no localStorage). */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/invoice/${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await submitEmailForm(page, email);
  const loaded = await waitForText(page, "LUNAS", 20000);
  const txt = norm(await bodyText(page));
  results.invoiceForm = {
    loaded,
    invoiceNumber: txt.includes(invoiceNumber),
    confirmed: txt.includes("Dikonfirmasi"),
    routeSection: /rute perjalanan/i.test(txt),
    pickupA: txt.includes("E2E Pickup Point"),
    dropoffB: txt.includes("E2E Dropoff Point"),
    duration: txt.includes("Durasi sewa: 2 hari"),
    withoutDriver: txt.includes("Tanpa supir"),
    vendorPickup: txt.includes("Ambil di lokasi vendor"),
    lunas: txt.includes("LUNAS"),
    refDoku: txt.includes(`Ref DOKU: ${invoiceNumber}`),
    ditagih: txt.includes("Ditagih:") && txt.includes("452.100"),
    conversion: txt.includes("Konversi saat bayar: 1 USD = Rp16.500"),
    paidDate: txt.includes("16 November 2026"),
    methodLabel: txt.includes("Kartu Kredit"),
    serviceFeeSingleDollar: txt.includes("Service Fee ($1)"),
    total: txt.includes("$27.40"),
    emailFormGone: !(await page.locator('input[type="email"]').count()),
  };
  await page.screenshot({ path: "scripts/tmp/e2e-doku-08-invoice-form.png", fullPage: true });
  await ctx.close();
}

/* C — invoice via localStorage auto-load (no email form). */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v),
    ["booking-vip:last-booking", JSON.stringify({ code, email })]);
  await page.goto(`${BASE}/invoice/${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const loaded = await waitForText(page, "LUNAS", 20000);
  const txt = norm(await bodyText(page));
  results.invoiceLocalStorage = {
    loaded,
    noEmailForm: !(await page.locator('input[type="email"]').count()),
    invoiceNumber: txt.includes(invoiceNumber),
    lunas: txt.includes("LUNAS"),
    refDoku: txt.includes(`Ref DOKU: ${invoiceNumber}`),
  };
  await page.screenshot({ path: "scripts/tmp/e2e-doku-09-invoice-localstorage.png", fullPage: true });
  await ctx.close();
}

/* D — negative: wrong email via the UI. */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/invoice/${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await submitEmailForm(page, "wrong-person@example.com");
  const notFound = await waitForText(page, "Invoice tidak ditemukan.", 15000);
  const txt = norm(await bodyText(page));
  results.negative = {
    notFound,
    noInvoiceData: !txt.includes("LUNAS") && !txt.includes(invoiceNumber) && !txt.includes("Rute perjalanan"),
    emailFormStillThere: !!(await page.locator('input[type="email"]').count()),
  };
  await page.screenshot({ path: "scripts/tmp/e2e-doku-10-invoice-negative.png", fullPage: true });
  await ctx.close();
}

/* E — return page via localStorage auto-load (the real PaymentStep flow). */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v),
    ["booking-vip:last-booking", JSON.stringify({ code, email })]);
  await page.goto(`${BASE}/payment/return?code=${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const paid = await waitForText(page, "Pembayaran berhasil", 30000);
  const txt = norm(await bodyText(page));
  results.returnPageLocalStorage = {
    paid,
    showsCode: txt.includes(code),
    hasInvoiceLink: txt.includes("Lihat invoice"),
    noEmailForm: !(await page.locator('input[type="email"]').count()),
  };
  await page.screenshot({ path: "scripts/tmp/e2e-doku-07b-return-localstorage.png", fullPage: true });
  await ctx.close();
}

console.log(JSON.stringify(results, null, 2));
state.uiResults = results;
fs.writeFileSync(new URL("./e2e-doku-state.json", import.meta.url), JSON.stringify(state, null, 2));
await browser.close();

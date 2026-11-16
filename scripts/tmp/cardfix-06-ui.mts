// Card-fix re-verification — steps 4 (screenshot) + 6 (guest invoice UI).
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/cardfix-06-ui.mts
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
const BASE = "http://localhost:3000";

const browser = await chromium.launch({ headless: true });
const results: any = {};
const norm = (s: string) => s.replace(/\u00a0/g, " ");

// Navigation-tolerant body text reader (the return page may refresh/navigate
// while polling — the previous script crashed on that).
async function bodyText(page: any): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      return (await page.evaluate(() => document.body.innerText)) ?? "";
    } catch {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
  return "";
}
async function waitForText(page: any, text: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (norm(await bodyText(page)).includes(text)) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}
async function submitEmailForm(page: any, address: string) {
  const inp = page.locator('input[type="email"]');
  await inp.fill(address);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const input = document.querySelector('input[type="email"]');
    (input as HTMLInputElement | null)?.closest("form")?.requestSubmit();
  });
}

/* A — return page. The live redirect went to the tunnel URL and loaded there
   (email form submitted), but the tunnel died AFTER payment+webhook completed
   (502 "no tunnel"). Same app/page is served on localhost — use it for the
   screenshot. */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k, v),
    ["booking-vip:last-booking", JSON.stringify({ code, email })],
  );
  await page.goto(`${BASE}/payment/return?code=${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  if (await page.locator('input[type="email"]').count()) {
    await submitEmailForm(page, email);
  }
  const paid = await waitForText(page, "Pembayaran berhasil", 45000);
  const txt = norm(await bodyText(page));
  results.returnPage = {
    paid,
    showsCode: txt.includes(code),
    hasInvoiceLink: txt.includes("Lihat invoice"),
    url: page.url(),
  };
  await page.screenshot({ path: "scripts/tmp/cardfix-02-return.png", fullPage: true }).catch(() => {});
  console.log("RETURN:", JSON.stringify(results.returnPage));
  console.log("return body:", txt.slice(0, 300));
  await ctx.close();
}

/* B — guest invoice via email form (fresh context, no localStorage). */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  const consoleMsgs: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];
  page.on("console", (m: any) => consoleMsgs.push({ type: m.type(), text: m.text() }));
  page.on("pageerror", (e: any) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/invoice/${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await submitEmailForm(page, email);
  const loaded = await waitForText(page, "LUNAS", 25000);
  await page.waitForTimeout(1500); // let any late warnings surface
  const txt = norm(await bodyText(page));
  results.invoiceForm = {
    loaded,
    confirmed: txt.includes("Dikonfirmasi"),
    lunas: txt.includes("LUNAS"),
    refDoku: txt.includes(`Ref DOKU: ${invoiceNumber}`),
    ditagih: /Ditagih:\s*Rp/.test(txt) && txt.includes("452.100"),
    duration: txt.includes("Durasi sewa: 2 hari"),
    invoiceNumberShown: txt.includes(invoiceNumber),
    emailFormGone: !(await page.locator('input[type="email"]').count()),
  };
  const warnings = consoleMsgs.filter((m) => m.type === "warning" || m.type === "error");
  const prerenderSuspense = consoleMsgs.filter((m) => /prerender|suspense/i.test(m.text));
  results.invoiceConsole = {
    totalMessages: consoleMsgs.length,
    warningsAndErrors: warnings,
    pageErrors,
    prerenderOrSuspenseWarnings: prerenderSuspense,
    clean: prerenderSuspense.length === 0 && pageErrors.length === 0,
  };
  await page.screenshot({ path: "scripts/tmp/cardfix-03-invoice.png", fullPage: true });
  console.log("INVOICE:", JSON.stringify(results.invoiceForm, null, 1));
  console.log("CONSOLE:", JSON.stringify(results.invoiceConsole, null, 1));
  console.log("invoice body:", txt.slice(0, 700));
  await ctx.close();
}

state.uiResults = results;
fs.writeFileSync(new URL("./cardfix-state.json", import.meta.url), JSON.stringify(state, null, 2));
await browser.close();

const ok =
  results.returnPage.paid &&
  results.invoiceForm.loaded &&
  results.invoiceForm.confirmed &&
  results.invoiceForm.lunas &&
  results.invoiceForm.refDoku &&
  results.invoiceForm.ditagih &&
  results.invoiceForm.duration &&
  results.invoiceConsole.clean;
console.log(ok ? "UI CHECKS: ALL PASS" : "UI CHECKS: FAIL");
if (!ok) process.exit(1);
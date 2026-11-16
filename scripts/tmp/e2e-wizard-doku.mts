// E2E: shared booking wizard (/booking/[slug]) must lead into DOKU payment,
// not a dead "confirmed" screen. Drives daihatsu-terios through identity +
// signature, submits, then asserts the DOKU PaymentStep renders and the pay
// button redirects to the DOKU sandbox.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/e2e-wizard-doku.mts
import { createRequire } from "node:module";
import "dotenv/config";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");

const URL =
  "http://localhost:3000/booking/daihatsu-terios?pkg=efb3745b-9b0c-42a3-a721-6f9af18a8203&date=2026-11-17&time=09:00&days=1&driverOption=without_driver";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => localStorage.setItem("booking-vip:locale", JSON.stringify("id")));
const page = await ctx.newPage();
const log = (...a: unknown[]) => console.log(...a);

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: "Lanjutkan" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Lanjutkan" }).click();

  // Details: contact + identity.
  await page.getByText("Identitas Penyewa").waitFor({ timeout: 20000 });
  await page.locator('input[type="text"]').nth(0).fill("E2E");
  await page.locator('input[type="text"]').nth(1).fill("Wizard");
  await page.locator('input[type="email"]').fill("e2e-wizard@example.com");
  await page.locator('input[type="tel"]').fill("08123456789");
  await page.locator('select:has(option[value="ktp"])').selectOption("ktp");
  await page.getByLabel("NIK").fill("3201234567890002");
  await page.setInputFiles('input[type="file"][accept*="application/pdf"]', { name: "ktp.png", mimeType: "image/png", buffer: PNG });
  await page.getByText("Dokumen terunggah").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Lanjut ke tanda tangan" }).click();

  // Signature.
  const canvas = page.locator("canvas");
  await canvas.waitFor({ timeout: 20000 });
  await canvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  const saveBtn = page.getByRole("button", { name: "Simpan tanda tangan" });
  for (let attempt = 0; attempt < 4 && !(await saveBtn.isEnabled()); attempt++) {
    await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (!c) return;
      const r = c.getBoundingClientRect();
      const base = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1 };
      const pt = (x: number, y: number) => ({ ...base, clientX: x, clientY: y });
      const cy = r.top + r.height / 2;
      c.dispatchEvent(new PointerEvent("pointerdown", pt(r.left + 40, cy)));
      c.dispatchEvent(new PointerEvent("pointermove", pt(r.left + r.width * 0.5, cy - 30)));
      c.dispatchEvent(new PointerEvent("pointermove", pt(r.left + r.width - 40, cy + 20)));
      c.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0, clientX: r.left + r.width - 40, clientY: cy + 20 }));
    });
    await page.waitForTimeout(400);
  }
  log("save button enabled:", await saveBtn.isEnabled());
  await saveBtn.click();
  await page.getByText("Tanda tangan tersimpan").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Lanjut ke Pembayaran" }).click();

  // Payment step → create booking.
  await page.getByRole("button", { name: "Pesan Sekarang" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Pesan Sekarang" }).click();

  // Clean checkout: compact "Pembayaran" header + PaymentStep, NO redundant
  // "Pemesanan Dibuat" hero / green check.
  await page.getByText("Pilih pembayaran").waitFor({ timeout: 40000 });
  await page.waitForFunction(() => /BV-[A-Z0-9]{6}/.test(document.body.innerText), { timeout: 20000 });
  const text = await page.evaluate(() => document.body.innerText);
  log("redundant 'Pemesanan Dibuat' hero absent (want true):", !text.includes("Pemesanan Dibuat"));
  log("DOKU card method present:", /Kartu Kredit/.test(text));
  log("DOKU QRIS method present:", text.includes("QRIS"));
  log("pay button present:", text.includes("Lanjut ke pembayaran"));
  await page.screenshot({ path: "scripts/tmp/e2e-wizard-doku-result.png", fullPage: true });

  // Click pay → sessionId is null (DOKU JS not activated) → fallback redirect
  // to the DOKU sandbox hosted checkout.
  await page.getByRole("button", { name: "Lanjut ke pembayaran" }).click();
  await page.waitForURL(/doku\.com/, { timeout: 40000 });
  log("redirected to DOKU:", page.url().slice(0, 90) + "…");
  log("DOKU checkout reached:", /sandbox\.doku\.com/.test(page.url()) ? "YES ✓" : "NO ✗");
  await page.screenshot({ path: "scripts/tmp/e2e-wizard-doku-checkout.png", fullPage: true });
  log("E2E PASS");
} catch (e) {
  await page.screenshot({ path: "scripts/tmp/e2e-wizard-doku-error.png", fullPage: true }).catch(() => {});
  console.error("E2E ERROR:", (e as Error).message);
} finally {
  await browser.close();
  process.exit(0);
}
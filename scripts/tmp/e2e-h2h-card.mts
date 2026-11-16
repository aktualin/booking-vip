// E2E: the full Host-to-Host card flow — the card form lives on OUR page.
// booking wizard → identity → signature → create booking → embedded card form
// → Bayar → DOKU 3DS (OTP) → /payment/3ds/return (charge) → return page paid.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/e2e-h2h-card.mts
import { createRequire } from "node:module";
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";
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
  await page.locator('input[type="text"]').nth(1).fill("H2H");
  await page.locator('input[type="email"]').fill("e2e-h2h@example.com");
  await page.locator('input[type="tel"]').fill("08123456789");
  await page.locator('select:has(option[value="ktp"])').selectOption("ktp");
  await page.getByLabel("NIK").fill("3201234567890003");
  await page.setInputFiles('input[type="file"][accept*="application/pdf"]', { name: "ktp.png", mimeType: "image/png", buffer: PNG });
  await page.getByText("Dokumen terunggah").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Lanjut ke tanda tangan" }).click();

  // Signature (dispatch PointerEvents — reliable in headless).
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
  await saveBtn.click();
  await page.getByText("Tanda tangan tersimpan").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Lanjut ke Pembayaran" }).click();

  // Payment step: method picker + card form ON OUR page + "Bayar Sekarang"
  // (booking creation and the payment start happen on submit).
  await page.getByPlaceholder("4111 1111 1111 1111").waitFor({ timeout: 40000 });
  log("payment step with embedded card form: true");
  await page.screenshot({ path: "scripts/tmp/e2e-h2h-payment-step.png", fullPage: true });

  // Fill the card form.
  await page.getByPlaceholder("4111 1111 1111 1111").fill("4617006911111106");
  await page.getByPlaceholder("MM/YY").fill("01/31");
  await page.getByPlaceholder("123").fill("123");
  await page.getByRole("button", { name: "Bayar Sekarang" }).click();

  // → DOKU 3DS page (the issuer's OTP — the only redirect).
  await page.waitForURL(/three-d-secure/, { timeout: 40000 });
  log("3DS page:", page.url().slice(0, 80) + "…");
  await page.waitForSelector("input", { timeout: 15000 });
  const bodyText = await page.evaluate(() => document.body.innerText);
  const otp = bodyText.match(/\(OTP:\s*(\d+)\)/i)?.[1] ?? "1234";
  await page.locator("input").first().fill(otp);
  await page.getByRole("button").first().click();
  await page.waitForTimeout(4000);
  log("URL right after OTP submit:", page.url().slice(0, 110));

  // → back to our 3ds return (charge) → the payment return page.
  await page.waitForURL(/\/payment\/return/, { timeout: 40000 });
  log("return URL:", page.url().slice(0, 110));
  try {
    await page.getByText("Pembayaran berhasil").waitFor({ timeout: 60000 });
    log("return page: Pembayaran berhasil ✓");
  } catch {
    const txt = await page.evaluate(() => document.body.innerText);
    log("return page text (first 300):", txt.replace(/\s+/g, " ").slice(0, 300));
    throw new Error("Pembayaran berhasil tidak muncul");
  }
  await page.screenshot({ path: "scripts/tmp/e2e-h2h-paid.png", fullPage: true });

  // DB: payment paid, booking confirmed.
  const text2 = await page.evaluate(() => document.body.innerText);
  const code = text2.match(/BV-[A-Z0-9]{6}/)?.[0];
  log("booking code:", code);
  const booking = (await db.orm.public.Booking.select("id", "status").where({ code }).limit(1).all())[0];
  const payment = (await db.orm.public.Payment
    .select("status", "provider", "providerRef", "paidAt")
    .where({ bookingId: booking.id })
    .orderBy((f) => f.createdAt.desc())
    .limit(1).all())[0];
  log("booking status:", booking.status, "| payment:", JSON.stringify(payment));
  log(booking.status === "confirmed" && payment.status === "paid" ? "E2E H2H: PASS" : "E2E H2H: FAIL");
} catch (e) {
  await page.screenshot({ path: "scripts/tmp/e2e-h2h-error.png", fullPage: true }).catch(() => {});
  console.error("E2E ERROR:", (e as Error).message);
} finally {
  await browser.close();
  process.exit(0);
}
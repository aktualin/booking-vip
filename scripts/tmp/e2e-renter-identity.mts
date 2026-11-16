// End-to-end: transport booking wizard → renter identity upload (R2) →
// signature canvas (R2) → createBooking → assert Contact identity persisted.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/e2e-renter-identity.mts
import { createRequire } from "node:module";
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");

const URL =
  "http://localhost:3000/booking/honda-brio?pkg=ae30ec6f-43ac-4abe-a67a-9c57d6113195&date=2026-11-17&time=09:00&days=1&driverOption=without_driver";
// A small valid PNG (1x1) for the ID upload test.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const ID_NUMBER = "3201234567890001";
const EMAIL = "e2e-renter@example.com";

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  localStorage.setItem("booking-vip:locale", JSON.stringify("id"));
});
const page = await ctx.newPage();
const log = (...a: unknown[]) => console.log(...a);

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // 1. Add-ons step → continue.
  await page.getByRole("button", { name: "Lanjutkan" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Lanjutkan" }).click();

  // 2. Details step: identity form present, guest toggle gone.
  await page.getByText("Identitas Penyewa").waitFor({ timeout: 20000 });
  const guestToggle = await page.locator('input[name="bookingFor"]').count();
  log("identity form present: true | guest toggle count (want 0):", guestToggle);

  // 3. Contact fields (labels are siblings without htmlFor — select by type).
  await page.locator('input[type="text"]').nth(0).fill("E2E");
  await page.locator('input[type="text"]').nth(1).fill("Renter");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="tel"]').fill("08123456789");

  // 4. Identity: type KTP, number, upload PNG to R2.
  await page.locator('select:has(option[value="ktp"])').selectOption("ktp");
  await page.getByLabel("NIK").fill(ID_NUMBER);
  await page.setInputFiles('input[type="file"][accept*="application/pdf"]', {
    name: "ktp.png", mimeType: "image/png", buffer: PNG,
  });
  await page.getByText("Dokumen terunggah").waitFor({ timeout: 30000 });
  log("ID uploaded to R2: true");

  // 5. Continue → signature step.
  await page.getByRole("button", { name: "Lanjut ke tanda tangan" }).click();
  const canvas = page.locator("canvas");
  await canvas.waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Simpan tanda tangan" }).waitFor();

  // 6. Draw a signature stroke, then save (uploads PNG to R2).
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 30, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, y - 30, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.7, y + 25, { steps: 12 });
  await page.mouse.move(box.x + box.width - 30, y - 10, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const saveBtn = page.getByRole("button", { name: "Simpan tanda tangan" });
  log("save button enabled after draw:", await saveBtn.isEnabled());
  await saveBtn.click();
  await page.getByText("Tanda tangan tersimpan").waitFor({ timeout: 30000 });
  log("signature saved to R2: true");
  await page.screenshot({ path: "scripts/tmp/e2e-renter-signature.png", fullPage: true });

  // 7. Continue → payment → submit.
  await page.getByRole("button", { name: "Lanjut ke Pembayaran" }).click();
  await page.getByRole("button", { name: "Pesan Sekarang" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Pesan Sekarang" }).click();

  // 8. Result step shows the booking code.
  await page.waitForFunction(() => /BV-[A-Z0-9]{6}/.test(document.body.innerText), { timeout: 40000 });
  const bodyText = await page.evaluate(() => document.body.innerText);
  const code = bodyText.match(/BV-[A-Z0-9]{6}/)?.[0];
  log("booking code:", code);
  await page.screenshot({ path: "scripts/tmp/e2e-renter-result.png", fullPage: true });

  // 9. Assert the identity + signature persisted on Contact.
  const booking = (await db.orm.public.Booking.select("id").where({ code }).limit(1).all())[0];
  if (!booking) throw new Error("booking not found in DB: " + code);
  const contact = (await db.orm.public.Contact
    .select("identityNumber", "idType", "idDocumentUrl", "signatureUrl")
    .where({ bookingId: booking.id }).limit(1).all())[0];
  log("Contact persisted:", JSON.stringify(contact));
  const ok =
    contact?.identityNumber === ID_NUMBER &&
    contact?.idType === "ktp" &&
    !!contact?.idDocumentUrl?.startsWith("/media/renter-docs/") &&
    !!contact?.signatureUrl?.startsWith("/media/signatures/");
  log(ok ? "E2E PASS" : "E2E FAIL");
} catch (e) {
  await page.screenshot({ path: "scripts/tmp/e2e-renter-error.png", fullPage: true }).catch(() => {});
  console.error("E2E ERROR:", (e as Error).message);
} finally {
  await browser.close();
  process.exit(0);
}
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:3000/booking/honda-brio?pkg=ae30ec6f-43ac-4abe-a67a-9c57d6113195&date=2026-11-17&time=09:00&days=1&driverOption=without_driver";
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => localStorage.setItem("booking-vip:locale", JSON.stringify("id")));
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText("Baby Seat / Child Seat").waitFor({ timeout: 30000 });
const text = await page.evaluate(() => document.body.innerText);
for (const name of ["Baby Seat / Child Seat","Cooler Box","GPS / Phone Holder","Supir Tambahan"]) {
  console.log((text.includes(name) ? "✓" : "✗"), name);
}
console.log("empty-state present (want false):", text.includes("Tidak ada layanan tambahan"));
await page.screenshot({ path: "scripts/tmp/addons-step.png", fullPage: true });
await browser.close();
process.exit(0);

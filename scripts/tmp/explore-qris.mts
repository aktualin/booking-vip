import "dotenv/config";
import { createQrisCheckout } from "../../src/lib/doku.ts";
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");
const res = await createQrisCheckout({
  invoiceNumber: "EXPLORE-QRIS-" + Date.now(),
  amountIdr: 10000,
  payerEmail: "explore-qris@example.com",
  description: "QRIS explore",
  successRedirectUrl: "https://0197730e87daee.app.lhr.life/payment/return?code=TEST",
  failureRedirectUrl: "https://0197730e87daee.app.lhr.life/payment/return?code=TEST&status=failed",
});
console.log("checkoutUrl:", res.checkoutUrl);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(res.checkoutUrl!, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
const text = await page.evaluate(() => document.body.innerText);
console.log("=== checkout page text (first 600) ===");
console.log(text.replace(/\s+/g," ").slice(0,600));
// look for QR string / canvas / img
const qrInfo = await page.evaluate(() => {
  const canvases = document.querySelectorAll("canvas").length;
  const imgs = Array.from(document.querySelectorAll("img")).map(i=>i.src.slice(0,60));
  return { canvases, imgs };
});
console.log("QR elements:", JSON.stringify(qrInfo));
await page.screenshot({ path: "scripts/tmp/qris-checkout.png", fullPage: true });
await browser.close();
process.exit(0);

import "dotenv/config";
import { createQrisCheckout } from "../../src/lib/doku.ts";
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");
const res = await createQrisCheckout({
  invoiceNumber: "EXPLORE2-QRIS-" + Date.now(),
  amountIdr: 10000,
  payerEmail: "explore2-qris@example.com",
  description: "QRIS explore 2",
  successRedirectUrl: "https://0197730e87daee.app.lhr.life/payment/return?code=TEST",
  failureRedirectUrl: "https://0197730e87daee.app.lhr.life/payment/return?code=TEST&status=failed",
});
const browser = await chromium.launch();
const page = await browser.newPage();
let qrString = "";
page.on("response", async (resp) => {
  try {
    const ct = resp.headers()["content-type"] ?? "";
    if (ct.includes("json")) {
      const t = await resp.text();
      const m = t.match(/000201[0-9A-Za-z.\-]+/);
      if (m && m[0].length > qrString.length) qrString = m[0];
      if (/qrContent|qrString|qr_content|emv/i.test(t)) console.log("API w/ QR:", resp.url().slice(0,80), t.slice(0,200));
    }
  } catch {}
});
await page.goto(res.checkoutUrl!, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4000);
console.log("QR string captured:", qrString ? qrString.slice(0,80)+"… (len "+qrString.length+")" : "NONE");
// try copy button / clipboard
const copyBtns = await page.locator("text=/copy/i").count();
console.log("copy-ish elements:", copyBtns);

// Now the simulator
const sim = await browser.newPage();
await sim.goto("https://sandbox.doku.com/qris-simulator/", { waitUntil: "networkidle", timeout: 60000 });
await sim.waitForTimeout(3000);
const simText = await sim.evaluate(() => document.body.innerText);
console.log("=== simulator text (first 500) ===");
console.log(simText.replace(/\s+/g," ").slice(0,500));
const inputs = await sim.evaluate(() => Array.from(document.querySelectorAll("input,textarea,select,button")).map(e=>({tag:e.tagName,type:(e as HTMLInputElement).type||"",ph:(e as HTMLInputElement).placeholder||"",txt:(e.textContent||"").trim().slice(0,30)})));
console.log("simulator controls:", JSON.stringify(inputs).slice(0,800));
await sim.screenshot({ path: "scripts/tmp/qris-simulator.png", fullPage: true });
await browser.close();
process.exit(0);

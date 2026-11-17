import "dotenv/config";
import { createQrisCheckout } from "../../src/lib/doku.ts";
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");
const res = await createQrisCheckout({ invoiceNumber:"CAP-QRIS-"+Date.now(), amountIdr:165000, payerEmail:"cap@example.com", description:"cap", successRedirectUrl:"https://0197730e87daee.app.lhr.life/payment/return?code=T", failureRedirectUrl:"https://0197730e87daee.app.lhr.life/payment/return?code=T&status=failed" });
const browser = await chromium.launch();
const page = await browser.newPage();
const hits: string[] = [];
page.on("response", async (resp) => {
  try {
    if ((resp.headers()["content-type"]??"").includes("json")) {
      const t = await resp.text();
      if (/000201/.test(t)) hits.push(resp.url() + "\n" + t);
    }
  } catch {}
});
await page.goto(res.checkoutUrl!, { waitUntil:"networkidle", timeout:60000 });
await page.waitForTimeout(4000);
for (const h of hits) console.log("=== HIT ===\n" + h.slice(0, 1200) + "\n");
await browser.close();
process.exit(0);

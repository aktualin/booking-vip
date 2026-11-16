// E2E Phase 5 — step 4d: capture the POST bodies the DOKU page sends.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const state = JSON.parse(
  fs.readFileSync(new URL("./e2e-doku-state.json", import.meta.url), "utf8"),
);
const url = state.startResult.checkoutUrl;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on("request", (req) => {
  if (req.method() === "POST") {
    console.log("[POST]", req.url());
    console.log("  headers:", JSON.stringify(req.headers()));
    console.log("  body:", (req.postData() ?? "").slice(0, 800));
  }
});
page.on("response", async (res) => {
  if (res.request().method() === "POST") {
    let body = "";
    try { body = (await res.text()).slice(0, 600); } catch {}
    console.log("[POST-res]", res.status(), res.url(), "\n  ", body);
  }
});
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 400)));
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning")
    console.log("[console]", msg.type(), msg.text().slice(0, 300));
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(20000);

// What does the page's own JS see as query params?
const parsed = await page.evaluate(() => {
  const sp = new URLSearchParams(location.search);
  return {
    search: location.search,
    hash: location.hash,
    invoiceNumber: sp.get("invoiceNumber"),
    requestId: sp.get("requestId"),
    transactionType: sp.get("transactionType"),
  };
});
console.log("page-parsed params:", JSON.stringify(parsed, null, 2));

await browser.close();

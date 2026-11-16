// E2E Phase 5 — step 4c: network/console diagnosis of the DOKU page.
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

page.on("console", (msg) => console.log("[console]", msg.type(), msg.text().slice(0, 300)));
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));
page.on("requestfailed", (req) =>
  console.log("[reqfail]", req.method(), req.url().slice(0, 160), req.failure()?.errorText),
);
page.on("response", async (res) => {
  const u = res.url();
  if (u.includes("sandbox.doku.com") && !/\.(js|css|png|jpg|svg|woff|ico)/.test(u)) {
    let body = "";
    try { body = (await res.text()).slice(0, 400); } catch {}
    console.log("[res]", res.status(), res.request().method(), u.slice(0, 160), "\n   ", body.replace(/\n/g, " "));
  }
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(25000);
console.log("final URL:", page.url());
console.log("body:", (await page.evaluate(() => document.body.innerText)).slice(0, 400));
await page.screenshot({ path: "scripts/tmp/e2e-doku-03-diagnosis.png", fullPage: true });
await browser.close();

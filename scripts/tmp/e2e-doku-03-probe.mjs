// E2E Phase 5 — step 4a: probe the DOKU hosted card payment page.
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
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console.error]", msg.text().slice(0, 200));
});

console.log("goto", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);

console.log("URL now:", page.url());
console.log("title:", await page.title());

await page.screenshot({ path: "scripts/tmp/e2e-doku-01-checkout.png", fullPage: true });

const info = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("input,select,textarea")].map((el) => ({
    tag: el.tagName,
    type: el.type || undefined,
    id: el.id || undefined,
    name: el.name || undefined,
    placeholder: el.placeholder || undefined,
    formControlName: el.getAttribute("formcontrolname") || undefined,
    visible: !!(el.offsetWidth || el.offsetHeight),
  }));
  const buttons = [...document.querySelectorAll("button,[role=button],input[type=submit]")].map((el) => ({
    tag: el.tagName,
    id: el.id || undefined,
    text: (el.textContent || el.value || "").trim().slice(0, 80),
    visible: !!(el.offsetWidth || el.offsetHeight),
  }));
  const iframes = [...document.querySelectorAll("iframe")].map((f) => f.src);
  return { inputs, buttons, iframes, bodyText: document.body.innerText.slice(0, 1500) };
});
console.log(JSON.stringify(info, null, 2));

await browser.close();

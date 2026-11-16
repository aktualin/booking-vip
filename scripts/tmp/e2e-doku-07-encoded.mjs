// E2E Phase 5 — step 4e: probe with '#' percent-encoded (workaround for the
// unencoded '#' in DOKU's returned URL). Payment itself stays 100% real.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const state = JSON.parse(
  fs.readFileSync(new URL("./e2e-doku-state.json", import.meta.url), "utf8"),
);
const url = state.startResult.checkoutUrl.replace("#", "%23");
console.log("encoded URL:", url);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("request", (req) => {
  if (req.method() === "POST") console.log("[POST]", req.url(), (req.postData() ?? "").slice(0, 300));
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

const deadline = Date.now() + 45000;
let found = false;
while (Date.now() < deadline && !found) {
  await page.waitForTimeout(2000);
  for (const frame of page.frames()) {
    try {
      const n = await frame.evaluate(
        () => document.querySelectorAll("input:not([type=hidden]),button").length,
      );
      if (n > 0) { found = true; break; }
    } catch {}
  }
}
console.log("visible controls found:", found);
await page.screenshot({ path: "scripts/tmp/e2e-doku-04-encoded-load.png", fullPage: true });

for (const frame of page.frames()) {
  try {
    const info = await frame.evaluate(() => ({
      url: location.href.slice(0, 120),
      inputs: [...document.querySelectorAll("input,select")].map((el) => ({
        type: el.type || undefined, id: el.id || undefined, name: el.name || undefined,
        placeholder: el.placeholder || undefined, fcn: el.getAttribute("formcontrolname") || undefined,
        visible: !!(el.offsetWidth || el.offsetHeight),
      })),
      buttons: [...document.querySelectorAll("button,[role=button]")].map((el) => ({
        id: el.id || undefined, text: (el.textContent || "").trim().slice(0, 60),
        visible: !!(el.offsetWidth || el.offsetHeight),
      })),
      text: document.body.innerText.slice(0, 600),
    }));
    if (info.inputs.length || info.buttons.length || info.text.trim()) {
      console.log("=== FRAME", info.url);
      console.log(JSON.stringify(info, null, 1));
    }
  } catch {}
}
await browser.close();

// E2E Phase 5 — steps 6/7: getGuestInvoice over HTTP (correct + wrong email).
import fs from "node:fs";
const ACTION_ID = "602e6ac8207ccc528e0966667eec3b706d3c14b049"; // getGuestInvoice (dev manifest)
const state = JSON.parse(fs.readFileSync(new URL("./e2e-doku-state.json", import.meta.url), "utf8"));
const code = state.createResult.code;

async function call(email) {
  const res = await fetch("http://localhost:3000/invoice/" + code, {
    method: "POST",
    headers: { "Next-Action": ACTION_ID, "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify([code, email]),
  });
  const text = await res.text();
  let result = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^[0-9a-f]+:(.*)$/);
    if (!m) continue;
    try { const p = JSON.parse(m[1]); if (p && typeof p === "object" && "ok" in p) result = p; } catch {}
  }
  return { status: res.status, result, raw: result ? undefined : text.slice(0, 800) };
}

const good = await call("e2e-doku@example.com");
console.log("=== CORRECT EMAIL ===");
console.log(JSON.stringify(good, null, 2));

const bad = await call("wrong-person@example.com");
console.log("=== WRONG EMAIL ===");
console.log(JSON.stringify(bad, null, 2));

state.invoiceGood = good.result;
state.invoiceBad = bad.result;
fs.writeFileSync(new URL("./e2e-doku-state.json", import.meta.url), JSON.stringify(state, null, 2));

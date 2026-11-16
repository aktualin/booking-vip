// E2E Phase 5 — step 3: startBookingPayment (CREDIT_CARD) over HTTP.
import fs from "node:fs";

const ACTION_ID = "40a3f82db2e3499cc7fc1e5fedb58c6abba1ec296d"; // startBookingPayment (dev manifest)
const state = JSON.parse(
  fs.readFileSync(new URL("./e2e-doku-state.json", import.meta.url), "utf8"),
);
const code = state.createResult.code;

const res = await fetch("http://localhost:3000/transport/booking", {
  method: "POST",
  headers: {
    "Next-Action": ACTION_ID,
    "Content-Type": "text/plain;charset=UTF-8",
  },
  body: JSON.stringify([
    { bookingCode: code, email: "e2e-doku@example.com", methodCode: "CREDIT_CARD" },
  ]),
});

const text = await res.text();
console.log("HTTP", res.status);

let result = null;
for (const line of text.split("\n")) {
  const m = line.match(/^[0-9a-f]+:(.*)$/);
  if (!m) continue;
  try {
    const parsed = JSON.parse(m[1]);
    if (parsed && typeof parsed === "object" && "ok" in parsed) result = parsed;
  } catch {
    /* not a plain JSON row */
  }
}

if (!result) {
  console.log("RAW FLIGHT:\n" + text.slice(0, 3000));
  process.exit(1);
}

console.log("RESULT:", JSON.stringify(result, null, 2));
state.startResult = result;
fs.writeFileSync(
  new URL("./e2e-doku-state.json", import.meta.url),
  JSON.stringify(state, null, 2),
);

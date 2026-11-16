// Card-fix re-verification — step 2: startBookingPayment (CREDIT_CARD) via HTTP.
// CRITICAL: checkoutUrl must come back ALREADY encoded (%23, no raw '#').
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/cardfix-02-start.mts
import "dotenv/config";
import fs from "node:fs";

const ACTION_ID = "40a3f82db2e3499cc7fc1e5fedb58c6abba1ec296d"; // startBookingPayment (dev manifest, verified)
const state = JSON.parse(
  fs.readFileSync(new URL("./cardfix-state.json", import.meta.url), "utf8"),
);
const code = state.createResult.code;
const invoiceNumber = state.createResult.invoiceNumber;

const res = await fetch("http://localhost:3000/transport/booking", {
  method: "POST",
  headers: {
    "Next-Action": ACTION_ID,
    "Content-Type": "text/plain;charset=UTF-8",
  },
  body: JSON.stringify([
    { bookingCode: code, email: "card-fix@example.com", methodCode: "CREDIT_CARD" },
  ]),
});

const text = await res.text();
console.log("HTTP", res.status);

let result: any = null;
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
  new URL("./cardfix-state.json", import.meta.url),
  JSON.stringify(state, null, 2),
);

if (!result.ok) {
  console.log("FAIL: startBookingPayment returned ok=false:", result.error);
  process.exit(1);
}

const url: string = result.checkoutUrl;
console.log("\ncheckoutUrl (EXACT):", url);

const hasEncoded = url.includes("%23");
const hasRawHash = url.includes("#");
const parsedInvoice = new URL(url).searchParams.get("invoiceNumber");

console.log("ASSERT contains %23:", hasEncoded ? "PASS" : "FAIL");
console.log("ASSERT no raw '#':", !hasRawHash ? "PASS" : "FAIL");
console.log(
  "ASSERT searchParams.invoiceNumber === invoiceNumber:",
  parsedInvoice === invoiceNumber ? "PASS" : "FAIL",
  `(got: ${JSON.stringify(parsedInvoice)}, want: ${JSON.stringify(invoiceNumber)})`,
);
console.log("URL fragment (must be empty):", JSON.stringify(new URL(url).hash));

if (!hasEncoded || hasRawHash || parsedInvoice !== invoiceNumber) {
  console.log("\nVERDICT: FIX FAILED — URL not properly encoded by the server.");
  process.exit(1);
}
console.log("\nVERDICT: URL-encoding fix PASS — server returned an already-encoded URL.");
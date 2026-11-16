// Card-fix re-verification — step 1: createBooking via HTTP server action.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/cardfix-01-create.mts
import "dotenv/config";
import fs from "node:fs";

const ACTION_ID = "403fd593cf9f4354767c955fe473ee9da4de9da783"; // createBooking (dev manifest, verified)

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(9, 0, 0, 0);

const input = {
  productSlug: "honda-brio",
  packageId: "62335dde-37b4-4772-bdbc-2063438b9dd4",
  serviceAt: tomorrow.toISOString(),
  adult: 1,
  child: 0,
  infant: 0,
  days: 2,
  pickupPolicy: "vendor_pickup",
  driverOption: "without_driver",
  notes: "Card-fix verification",
  addOns: [],
  travelers: [],
  contact: {
    title: "mr",
    firstName: "Card",
    lastName: "Fix",
    email: "card-fix@example.com",
    phoneCountryCode: "ID",
    phone: "08123456789",
    isGuestSelf: false,
  },
  flight: {},
  pickup: { label: "Card Fix Pickup", lat: -6.2, lng: 106.8 },
  dropoff: { label: "Card Fix Dropoff", lat: -6.3, lng: 106.9 },
  currencyCode: "USD",
  fxRate: 1,
};

const res = await fetch("http://localhost:3000/transport/booking", {
  method: "POST",
  headers: {
    "Next-Action": ACTION_ID,
    "Content-Type": "text/plain;charset=UTF-8",
  },
  body: JSON.stringify([input]),
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

if (!result.ok) {
  console.log("FAIL: createBooking returned ok=false");
  process.exit(1);
}
if (!String(result.invoiceNumber ?? "").startsWith("#INV/")) {
  console.log("FAIL: invoiceNumber does not start with '#INV/'");
  process.exit(1);
}
console.log("ASSERT invoiceNumber starts with '#INV/': PASS");

fs.writeFileSync(
  new URL("./cardfix-state.json", import.meta.url),
  JSON.stringify({ createResult: result, input }, null, 2),
);
console.log("state saved");
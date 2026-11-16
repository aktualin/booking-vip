// E2E Phase 5 — step 1: create a transport booking via the createBooking
// server action over HTTP (same call the UI makes).
import fs from "node:fs";

const ACTION_ID = "403fd593cf9f4354767c955fe473ee9da4de9da783"; // createBooking (dev manifest)

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
  notes: "E2E DOKU sandbox test",
  addOns: [],
  travelers: [],
  contact: {
    title: "mr",
    firstName: "E2E",
    lastName: "Doku",
    email: "e2e-doku@example.com",
    phoneCountryCode: "ID",
    phone: "08123456789",
    isGuestSelf: false,
  },
  flight: {},
  pickup: { label: "E2E Pickup Point", lat: -6.2, lng: 106.8 },
  dropoff: { label: "E2E Dropoff Point", lat: -6.3, lng: 106.9 },
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

// The action result is a JSON row in the RSC flight stream.
let result = null;
for (const line of text.split("\n")) {
  const m = line.match(/^[0-9a-f]+:(.*)$/);
  if (!m) continue;
  try {
    const parsed = JSON.parse(m[1]);
    if (parsed && typeof parsed === "object" && "ok" in parsed) {
      result = parsed;
    }
  } catch {
    /* not a plain JSON row */
  }
}

if (!result) {
  console.log("RAW FLIGHT:\n" + text.slice(0, 3000));
  process.exit(1);
}

console.log("RESULT:", JSON.stringify(result, null, 2));
fs.writeFileSync(
  new URL("./e2e-doku-state.json", import.meta.url),
  JSON.stringify({ createResult: result, input }, null, 2),
);

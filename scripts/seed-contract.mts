#!/usr/bin/env node --experimental-strip-types
// Idempotent seed for the transport rental agreement articles.
//
// The articles are stored in the `ContractClause` table and edited by the
// operator in the admin area (Settings → Rental agreement). They are written
// in English on purpose: the agreement the renter signs is an English
// contract, and the admin form renders the content as-is (no translation).
//
// Run:  node --experimental-strip-types scripts/seed-contract.mts
//   (or `npm run db:seed-contract` from repo root)
//
// The seed only inserts when the table is EMPTY — once an operator touched
// the articles in the admin area, nothing here overwrites their copy.

import "dotenv/config";
import { db } from "../src/prisma/db.ts";

type Clause = { title: string; body: string };

const CLAUSES: Clause[] = [
  {
    title: "Renter Documents and Eligibility",
    body: [
      "The Renter warrants that the identity document and, where applicable, the driving licence provided during booking are valid, current and issued in the Renter's own name.",
      "The Renter must present the original documents to the driver or officer at vehicle handover. The Company may refuse the rental without refund when the documents cannot be verified.",
    ].join("\n"),
  },
  {
    title: "Rental Period and Vehicle Handover",
    body: [
      "The rental period starts at the handover time stated in the booking and runs for the number of rental days paid for. One rental day equals twenty-four (24) hours from handover.",
      "The vehicle is handed over at the pickup point chosen in the booking, or delivered to the Renter's address when the delivery option was selected. The Renter inspects the vehicle at handover; signed acceptance of the vehicle condition is recorded by the signature on this agreement.",
    ].join("\n"),
  },
  {
    title: "Fuel, Toll and Parking",
    body: [
      "Fuel is for the Renter's account. The vehicle is handed over with the fuel level recorded at handover and must be returned at the same level unless otherwise agreed.",
      "Toll fees, parking fees and any traffic fines caused during the rental period are for the Renter's account, including fines notified after the vehicle is returned.",
    ].join("\n"),
  },
  {
    title: "Use of the Vehicle and Prohibitions",
    body: [
      "The Renter may use the vehicle only within the island and region stated in the booking and only for lawful personal or business transport.",
      "The Renter shall not sub-lease the vehicle, use it for racing or testing, transport hazardous or illegal goods, drive under the influence of alcohol or drugs, or operate the vehicle outside its designed capacity. Off-road use is prohibited unless the vehicle class explicitly allows it.",
    ].join("\n"),
  },
  {
    title: "Driver and Overtime",
    body: [
      "For rentals with the Company's driver, the driver follows the itinerary agreed in the booking; route changes on the day are subject to the driver's duty-hour limits.",
      "Use beyond the included hours per rental day is charged as overtime at the rate published on the product page. Overtime is settled before the vehicle is returned or invoiced afterwards when the Company agrees.",
    ].join("\n"),
  },
  {
    title: "Insurance, Damage and Liability",
    body: [
      "The vehicle carries standard third-party and comprehensive insurance subject to the policy excess. The Renter bears the policy excess and any damage excluded by the policy, including damage to tyres, glass, undercarriage and interior, and loss of accessories.",
      "The Renter must report any accident, theft or damage to the Company immediately and must not repair the vehicle without the Company's written consent. A police report is required for theft and for accidents involving third parties.",
    ].join("\n"),
  },
  {
    title: "Cancellation and Refunds",
    body: [
      "Cancellations follow the cancellation policy published on the website and configured for this service line; the refund due, if any, is returned to the original payment method.",
      "When the Company cannot provide the booked vehicle class, the Company offers an equivalent or higher class at no extra cost, or refunds the paid amount in full when the Renter declines.",
    ].join("\n"),
  },
  {
    title: "Governing Law and Disputes",
    body: [
      "This agreement is governed by the laws of the Republic of Indonesia.",
      "The parties settle any dispute amicably first; failing that, the dispute is brought before the court of the Company's registered domicile, without excluding other venues the law allows.",
    ].join("\n"),
  },
];

const existing = await db.orm.public.ContractClause.aggregate((a) => ({
  n: a.count(),
}));

if (existing.n > 0) {
  console.log(
    `ContractClause already holds ${existing.n} article(s) — seed skipped, the admin-edited copy wins.`,
  );
  await db.close();
  process.exit(0);
}

for (const [index, clause] of CLAUSES.entries()) {
  await db.orm.public.ContractClause.create({
    id: crypto.randomUUID(),
    title: clause.title,
    body: clause.body,
    active: true,
    sortOrder: index + 1,
  });
}

console.log(`Seeded ${CLAUSES.length} rental agreement articles.`);
await db.close();

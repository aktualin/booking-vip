#!/usr/bin/env node --experimental-strip-types
// Idempotent seed for `Country.voaEligible` — the Indonesian Visa on Arrival
// subject list.
//
// The `Country` table is seeded (scripts/seed.mts) from the official VOA
// subject list published by the Directorate General of Immigration
// (Direktorat Jenderal Imigrasi — see the latest Keputusan Menteri
// Hukum dan HAM about VOA subjects), so EVERY row except the explicitly
// excluded ones is VOA-eligible. Indonesia itself is excluded: its citizens
// obviously need no VOA.
//
// When the official list changes:
//   - a country ADDED to the VOA list  → insert the Country row (seed.mts);
//     this script marks it eligible automatically.
//   - a country REMOVED from the list  → add its ISO code to NOT_VOA below
//     and re-run this script (the row stays, so the wizard can still warn
//     its travellers that the paperwork differs).
//
// Run:  node --experimental-strip-types scripts/seed-voa.mts
//   (or `npm run db:seed-voa` from repo root)

import "dotenv/config";
import { db } from "../src/prisma/db.ts";

/** ISO 3166-1 alpha-2 codes that are NOT VOA subjects. */
const NOT_VOA = ["ID"]; // Indonesia

async function main() {
  const rows = await db.orm.public.Country.select("code", "voaEligible").all();

  let setTrue = 0;
  let setFalse = 0;

  for (const row of rows) {
    const eligible = !NOT_VOA.includes(row.code);
    if (row.voaEligible !== eligible) {
      await db.orm.public.Country
        .where((f) => f.code.eq(row.code))
        .update({ voaEligible: eligible });
      eligible ? setTrue++ : setFalse++;
    }
  }

  console.log(
    `[seed-voa] ${rows.length} countries checked — ` +
      `${setTrue} marked eligible, ${setFalse} marked ineligible ` +
      `(${rows.length - setTrue - setFalse} already correct).`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-voa] failed", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));

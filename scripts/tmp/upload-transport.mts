#!/usr/bin/env node --experimental-strip-types
// One-off: upload public/images/transport/*.jpg into the R2 bucket under the
// `transport/<file>` keys the Media rows already reference. The repo's
// images:upload script only scans top-level files with known prefixes, so the
// transport subfolder is handled here. Idempotent: existing objects are skipped.
//
// Run: node --experimental-strip-types scripts/tmp/upload-transport.mts

import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { R2_BUCKET, objectExists, putObject } from "../../src/lib/storage.ts";

const DIR = path.join(process.cwd(), "public", "images", "transport");

const files = (await readdir(DIR)).filter((f) => f.endsWith(".jpg")).sort();
let uploaded = 0;
let skipped = 0;

for (const file of files) {
  const key = `transport/${file}`;
  if (await objectExists(key)) {
    skipped++;
    console.log(`  = ${key} — already in ${R2_BUCKET}`);
    continue;
  }
  const bytes = await readFile(path.join(DIR, file));
  await putObject(key, bytes, "image/jpeg");
  uploaded++;
  console.log(`  ✓ ${key} (${(bytes.length / 1024).toFixed(0)} KB)`);
}

console.log(`\nDone: ${uploaded} uploaded, ${skipped} already present (${files.length} files).`);
process.exit(0);

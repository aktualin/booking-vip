// Throwaway: prove the R2 credentials work end-to-end (put → get → delete).
//
//   node --experimental-strip-types --conditions react-server scripts/tmp/verify-upload.mts
//
// Optional: pass an existing object key as argv[2] to only delete it
// (cleanup for objects created by the curl tests).

import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  putObject,
  getObjectMeta,
  deleteObject,
  mediaUrl,
} from "../../src/lib/storage.ts";

// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const cleanupKey = process.argv[2];
if (cleanupKey) {
  try {
    await deleteObject(cleanupKey);
    console.log(`CLEANED ${cleanupKey}`);
    process.exit(0);
  } catch (err) {
    console.error("CLEANUP FAIL:", err);
    process.exit(1);
  }
}

const key = `renter-docs/_test_${randomUUID()}.png`;
let pass = false;
try {
  await putObject(key, PNG, "image/png");
  const meta = await getObjectMeta(key);
  if (!meta) throw new Error("object missing after put");
  if (!meta.body.equals(PNG)) throw new Error("stored body differs from uploaded bytes");
  console.log(
    `uploaded + verified: ${key} (${meta.body.byteLength} bytes, ${meta.contentType}) url=${mediaUrl(key)}`,
  );
  pass = true;
} catch (err) {
  console.error("R2 FAIL:", err);
} finally {
  try {
    await deleteObject(key);
    console.log(`cleaned up: ${key}`);
  } catch (err) {
    console.error("cleanup failed:", err);
  }
}
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);

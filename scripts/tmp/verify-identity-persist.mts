// Throwaway verification that the renter-identity columns persist on Contact.
// Run: node --experimental-strip-types scripts/tmp/verify-identity-persist.mts
//
// Two proofs, neither touches a real booking:
//   1. The four columns are queryable on existing Contact rows (read-only).
//   2. A brand-new throwaway Booking + Contact is created WITH the four
//      fields, read back, asserted, then deleted — proving the create path
//      accepts the columns at runtime. Cleanup runs even on failure.
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

const FIELDS = ["identityNumber", "idType", "idDocumentUrl", "signatureUrl"] as const;

// 1. Queryable on existing rows (read-only, no mutation).
const sample = await db.orm.public.Contact
  .select("id", "identityNumber", "idType", "idDocumentUrl", "signatureUrl")
  .limit(1)
  .all();
console.log("[1] Contact.select(identity fields) OK — rows:", sample.length);
console.log("    sample:", JSON.stringify(sample[0] ?? null));

// 2. Create + read + delete a throwaway booking/contact.
const bookingId = crypto.randomUUID();
const contactId = crypto.randomUUID();
const code = "BV-TMP" + Math.random().toString(36).slice(2, 8).toUpperCase();
const identity = {
  identityNumber: "3171234567890123",
  idType: "ktp",
  idDocumentUrl: "https://example.com/tmp-id.pdf",
  signatureUrl: "https://example.com/tmp-signature.png",
};

try {
  await db.orm.public.Booking.create({
    id: bookingId,
    code,
    serviceAt: new Date(Date.now() + 86400000),
    subtotalUsdCents: 0,
    totalUsdCents: 0,
  });

  await db.orm.public.Contact.create({
    id: contactId,
    bookingId,
    firstName: "Tmp",
    lastName: "Verify",
    email: "tmp-verify@example.com",
    phoneCountryCode: "+62",
    phone: "81234567890",
    isGuestSelf: true,
    ...identity,
  });

  const rows = await db.orm.public.Contact
    .select("id", "identityNumber", "idType", "idDocumentUrl", "signatureUrl")
    .where((f) => f.id.eq(contactId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) throw new Error("contact not read back");

  for (const key of FIELDS) {
    if (row[key] !== identity[key]) {
      throw new Error(`mismatch on ${key}: ${String(row[key])} !== ${identity[key]}`);
    }
  }
  console.log("[2] Contact.create WITH identity fields + read-back OK:", JSON.stringify(row));
} finally {
  // Self-cleaning: remove the throwaway rows even if an assertion failed.
  await db.orm.public.Contact.where((f) => f.bookingId.eq(bookingId)).deleteAll();
  await db.orm.public.Booking.where((f) => f.id.eq(bookingId)).deleteAll();
  console.log("[cleanup] throwaway booking + contact deleted");
}

console.log("PASS: renter-identity columns persist and are queryable.");
process.exit(0);
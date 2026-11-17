// Throwaway: which active bookings reserve the products showing reduced
// availability (Xenia, Terios, Camry, Brio)?
import { db } from "@/prisma/db";

const rows = await db.query(
  db.raw.sql`
    SELECT p."title" AS title, b."code" AS code, b."status" AS status,
           bi."vehicleCount" AS units, b."createdAt" AS created
    FROM "BookingItem" bi
    JOIN "Booking" b ON b."id" = bi."bookingId"
    JOIN "Product" p ON p."id" = bi."productId"
    WHERE p."slug" IN ('daihatsu-all-new-xenia-2022','daihatsu-terios','toyota-camry','honda-brio')
      AND (b."status" = 'confirmed'
           OR (b."status" = 'awaiting_payment' AND b."createdAt" >= now() - interval '24 hours'))
    ORDER BY p."title", b."createdAt"
  `.returnsRow({
    title: "pg/text@1",
    code: "pg/text@1",
    status: "pg/text@1",
    units: "pg/int4@1",
    created: "pg/timestamp-date@1",
  }).build(),
);

for (const r of rows) {
  console.log(`${r.title}  ${r.code}  ${r.status}  units=${r.units}  created=${r.created?.toISOString()}`);
}
console.log(`${rows.length} active reserving lines.`);
process.exit(0);

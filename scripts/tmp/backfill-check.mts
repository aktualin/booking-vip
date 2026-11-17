// Throwaway: confirm the booking_item_vehicle_count backfill.
// Run: node --import ./scripts/tmp/alias-hook.mjs --conditions react-server scripts/tmp/backfill-check.mts
import { db } from "@/prisma/db";

const mismatch = await db.query(
  db.raw.sql`
    SELECT COUNT(*)::int4 AS n
    FROM "BookingItem" bi
    JOIN "Booking" b ON b."id" = bi."bookingId"
    WHERE bi."vehicleCount" <> b."vehicleCount"
      AND (SELECT COUNT(*) FROM "BookingItem" x WHERE x."bookingId" = bi."bookingId") = 1
  `.returnsRow({ n: "pg/int4@1" }).build(),
);
const totals = await db.query(
  db.raw.sql`
    SELECT COUNT(*)::int4 AS items,
           SUM(CASE WHEN bi."vehicleCount" > 1 THEN 1 ELSE 0 END)::int4 AS multi
    FROM "BookingItem" bi
  `.returnsRow({ items: "pg/int4@1", multi: "pg/int4@1" }).build(),
);
console.log("single-item mismatches after backfill:", mismatch[0]?.n, "(expect 0)");
console.log("booking items:", totals[0]?.items, "| items with vehicleCount > 1:", totals[0]?.multi);
await db.close();

import "server-only";

import { db } from "@/prisma/db";
import { param } from "@prisma/orm-postgres/relational-core/expression";

/**
 * Rental stock of the transport fleet.
 *
 * A product's `stockTotal` is how many units of the vehicle the vendor owns.
 * The available stock is derived — never stored — from the bookings that
 * actively reserve units:
 *
 *   - every "confirmed" booking reserves its items' `vehicleCount`, always;
 *   - an "awaiting_payment" booking reserves its items' `vehicleCount` for
 *     {@link STOCK_RESERVATION_TTL_MS} after creation, then lazily expires
 *     (no cron — the reservation simply stops counting);
 *   - "completed" and "cancelled" bookings reserve nothing.
 *
 * The count lives on each BookingItem (one line per cart entry), so a
 * multi-car booking reserves every product it holds, per line.
 */

/** How long an unpaid booking keeps its units reserved (24 hours). */
export const STOCK_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The available stock of each requested product:
 * `stockTotal − reserved`, clamped at 0.
 *
 * One aggregate query joins BookingItem → Booking over the active bookings
 * and sums the per-item `vehicleCount` per product; a second query reads
 * `stockTotal`. Products that do not exist are absent from the returned map.
 */
export async function getAvailableStock(
  productIds: string[],
): Promise<Map<string, number>> {
  const available = new Map<string, number>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return available;

  const cutoff = new Date(Date.now() - STOCK_RESERVATION_TTL_MS);

  // Reserved units per product — confirmed bookings always count, unpaid
  // ones only while they are younger than the reservation TTL. The id list
  // binds as one parameter; the driver serialises the JS array and the
  // explicit cast turns it into a text[] for ANY().
  const reservedRows = await db.query(
    db.raw.sql`
      SELECT bi."productId" AS "productId",
             SUM(bi."vehicleCount")::int4 AS "reserved"
      FROM "BookingItem" bi
      JOIN "Booking" b ON b."id" = bi."bookingId"
      WHERE bi."productId" = ANY(${param(ids, { codecId: "pg/text@1" })}::text[])
        AND (
          b."status" = 'confirmed'
          OR (
            b."status" = 'awaiting_payment'
            AND b."createdAt" >= ${param(cutoff, { codecId: "pg/timestamp-date@1" })}
          )
        )
      GROUP BY bi."productId"
    `
      .returnsRow({ productId: "pg/text@1", reserved: "pg/int4@1" })
      .build(),
  );

  const reserved = new Map<string, number>();
  for (const row of reservedRows) {
    reserved.set(row.productId, row.reserved);
  }

  const products = await db.orm.public.Product
    .select("id", "stockTotal")
    .where((f) => f.id.in(ids))
    .all();

  for (const product of products) {
    const used = reserved.get(product.id) ?? 0;
    available.set(product.id, Math.max(0, product.stockTotal - used));
  }

  return available;
}

/**
 * Guard for booking creation: fails with an Indonesian customer-facing
 * error when the requested count exceeds the available stock.
 */
export async function assertStockAvailable(
  productId: string,
  count: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const stock = await getAvailableStock([productId]);
  const available = stock.get(productId) ?? 0;
  if (count > available) {
    return {
      ok: false,
      error: `Stok mobil tidak cukup. Tersisa ${available} unit.`,
    };
  }
  return { ok: true };
}

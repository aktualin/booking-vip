// Throwaway: inspect transport stock state.
import { db } from "@/prisma/db";
import { getAvailableStock } from "@/lib/stock";

const line = await db.orm.public.ServiceLine.select("id").where((f) => f.slug.eq("transport")).limit(1).all();
const products = await db.orm.public.Product
  .select("id", "slug", "stockTotal", "active")
  .where((f) => f.lineId.eq(line[0]!.id)).all();
const stock = await getAvailableStock(products.map((p) => p.id));
for (const p of products) {
  console.log(`${p.slug}  active=${p.active}  stockTotal=${p.stockTotal}  available=${stock.get(p.id) ?? 0}`);
}
const active = await db.orm.public.Booking
  .select("code", "status", "vehicleCount", "createdAt")
  .where((f) => f.status.in(["confirmed", "awaiting_payment"]))
  .orderBy((f) => f.createdAt.desc()).limit(15).all();
console.log("\nactive bookings:", active.length);
for (const b of active) console.log(`  ${b.code} ${b.status} vehicles=${b.vehicleCount} created=${new Date(b.createdAt).toISOString()}`);
await db.close();

// Throwaway stock sanity check: list transport products with stockTotal and
// the derived available count (getAvailableStock), to confirm the backfilled
// fleet values.
//
// Run: node --import ./scripts/tmp/cart-alias-hook.mjs --experimental-strip-types --conditions react-server scripts/tmp/stock-sanity.mts
import { db } from "@/prisma/db";
import { getAvailableStock } from "@/lib/stock";

const line = await db.orm.public.ServiceLine
  .select("id")
  .where({ slug: "transport" })
  .first();

if (!line) {
  console.log("transport service line not found");
  process.exit(1);
}

const products = await db.orm.public.Product
  .select("id", "slug", "title", "stockTotal", "active")
  .where((f) => f.lineId.eq(line.id))
  .where((f) => f.isAddOn.eq(false))
  .orderBy((f) => f.title.asc())
  .all();

const stock = await getAvailableStock(products.map((p) => p.id));

console.log(`${"title".padEnd(38)} ${"slug".padEnd(30)} active  stockTotal  available`);
for (const p of products) {
  console.log(
    `${p.title.padEnd(38)} ${p.slug.padEnd(30)} ${String(p.active).padEnd(7)} ${String(p.stockTotal).padEnd(11)} ${stock.get(p.id) ?? "—"}`,
  );
}
console.log(`\n${products.length} transport products listed.`);
process.exit(0);

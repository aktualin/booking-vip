// One-off backfill: apply the seed's intended stockFor() to the EXISTING
// rental fleet (products created before Product.stockTotal existed carry the
// schema default 1). Only raises rows still at 1; admin owns the number after
// this. Run: node --experimental-strip-types --conditions react-server scripts/tmp/backfill-fleet-stock.mts
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

const COMMON = [
  "toyota-grand-new-avanza",
  "toyota-all-new-avanza-2022",
  "daihatsu-all-new-xenia-2022",
  "daihatsu-sigra",
  "mitsubishi-xpander",
  "honda-brio",
];

const line = (await db.orm.public.ServiceLine.select("id").where((f) => f.slug.eq("transport")).all())[0];
if (!line) throw new Error("transport line missing");

const products = await db.orm.public.Product
  .select("id", "slug", "stockTotal", "serviceTypeId")
  .where((f) => f.lineId.eq(line.id))
  .where((f) => f.isAddOn.eq(false))
  .all();

const types = await db.orm.public.ServiceType.select("id", "slug").all();
const typeSlug = new Map(types.map((t) => [t.id, t.slug]));

// Rental fleet = transport products with an active per_day package.
const items = await db.orm.public.ProductPackage
  .select("productId")
  .where((f) => f.unitKind.eq("per_day"))
  .where((f) => f.active.eq(true))
  .all();
const fleet = new Set(items.map((i) => i.productId));

let changed = 0;
for (const p of products) {
  if (!fleet.has(p.id)) continue;
  const isLuxury = typeSlug.get(p.serviceTypeId ?? "") === "luxury" || p.slug === "toyota-hiace-premio";
  const target = isLuxury ? 1 : COMMON.includes(p.slug) ? 3 : 2;
  if (p.stockTotal === 1 && target > 1) {
    await db.orm.public.Product.where((f) => f.id.eq(p.id)).update({ stockTotal: target });
    console.log(`~ ${p.slug}: 1 -> ${target}`);
    changed++;
  }
}
console.log(`backfill done: ${changed} raised, ${fleet.size} fleet products total`);
await db.close();

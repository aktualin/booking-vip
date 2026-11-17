import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

const dps = await db.orm.public.Product
  .select("id", "slug", "title", "active", "leadTimeHours", "direction", "included", "airportId")
  .where({ slug: "airport-vip-dps" })
  .first();
console.log("airport-vip-dps:", JSON.stringify(dps, null, 1));

if (dps) {
  const pkgs = await db.orm.public.ProductPackage
    .select("label", "unitKind", "adultUsdCents", "childUsdCents", "sortOrder", "active")
    .where((f) => f.productId.eq(dps.id))
    .orderBy((f) => f.sortOrder.asc())
    .all();
  console.log("packages:", JSON.stringify(pkgs));

  const edges = await db.orm.public.ProductAddOn
    .select("addOnId")
    .where((f) => f.productId.eq(dps.id))
    .all();
  const addOns = await db.orm.public.Product
    .select("slug", "title", "fromPriceUsdCents", "isAddOn", "active")
    .where((f) => f.id.in(edges.map((e) => e.addOnId)))
    .all();
  console.log("add-ons:", JSON.stringify(addOns));
}

const activeVip = await db.orm.public.Product
  .select("slug", "isAddOn")
  .where((f) => f.active.eq(true))
  .all();
const legacyStillActive = activeVip.filter(
  (p) => !p.isAddOn && !p.slug.startsWith("airport-vip-") &&
    ["vip-terminal-buggy","baggage-porter-assistance","meet-greet","fast-track-immigration","family-vip-package","premium-lounge-access"].includes(p.slug),
);
console.log("legacy VIP still active (must be 0):", legacyStillActive.length);

const id = await db.orm.public.Country.select("code", "name", "voaEligible").where({ code: "ID" }).first();
const au = await db.orm.public.Country.select("code", "name", "voaEligible").where({ code: "AU" }).first();
console.log("voaEligible check:", JSON.stringify({ id, au }));
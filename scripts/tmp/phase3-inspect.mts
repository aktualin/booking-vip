import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

const lines = await db.orm.public.ServiceLine.select("id", "slug").all();
console.log("ServiceLines:", lines.map((l) => `${l.slug}=${l.id}`).join(", "));

const vipLine = lines.find((l) => l.slug === "vip-service");
if (vipLine) {
  const types = await db.orm.public.ServiceType
    .select("id", "slug", "name")
    .where((f) => f.lineId.eq(vipLine.id))
    .all();
  console.log("VIP ServiceTypes:", JSON.stringify(types));

  const products = await db.orm.public.Product
    .select("id", "slug", "title", "airportId", "isAddOn", "active", "fromPriceUsdCents", "imageUrl", "tone", "serviceTypeId")
    .where((f) => f.lineId.eq(vipLine.id))
    .all();
  for (const p of products) {
    const pkgs = await db.orm.public.ProductPackage
      .select("label", "unitKind", "adultUsdCents", "childUsdCents", "unitUsdCents", "active")
      .where((f) => f.productId.eq(p.id))
      .all();
    console.log(`Product ${p.slug} active=${p.active} addOn=${p.isAddOn} from=${p.fromPriceUsdCents} tone=${p.tone} img=${p.imageUrl ? "yes" : "no"} airport=${p.airportId}`);
    console.log("   pkgs:", JSON.stringify(pkgs));
  }
}

const airports = await db.orm.public.Airport
  .select("id", "name", "city", "iataCode", "kind", "active")
  .where((f) => f.kind.eq("airport"))
  .all();
console.log("Airports:", JSON.stringify(airports));

const countries = await db.orm.public.Country
  .select("code", "name", "voaEligible", "active")
  .orderBy((f) => f.name.asc())
  .limit(200)
  .all();
console.log("Countries:", countries.length, "voaEligible=false:", countries.filter((c) => !c.voaEligible).map((c) => c.code).join(","));

const addOnEdges = await db.orm.public.ProductAddOn.select("productId", "addOnId").limit(50).all();
console.log("ProductAddOn edges:", addOnEdges.length);
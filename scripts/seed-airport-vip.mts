#!/usr/bin/env node --experimental-strip-types
// Idempotent seed for the pivoted Airport VIP catalog (Phase 3).
//
// ONE product per airport ("Airport VIP Service", slug airport-vip-<iata>)
// with two package tiers (Fast Track / VIP + Lounge), plus the shared
// "voa-handling" add-on linked to every airport product. Legacy vip-service
// products are deactivated (never deleted — historical bookings keep FKs).
//
// Run:  npm run db:seed-airport-vip
// Requires the base catalog (npm run db:seed) to have run first.

import "dotenv/config";
import { db } from "../src/prisma/db.ts";

// ---------- tiny helpers ----------
const counts: Record<string, { created: number; existing: number; updated: number }> = {};
function bump(table: string, kind: "created" | "existing" | "updated") {
  counts[table] ??= { created: 0, existing: 0, updated: 0 };
  counts[table][kind]++;
}

/** The numbered greeter steps of the one airport VIP product. */
const INCLUDED = [
  "Meet your greeter at the arrival gate / arrival hall",
  "Fast-track immigration lane — skip the regular queue",
  "Visa on Arrival & customs assistance",
  "Escort to the lounge or terminal exit",
];

const REQUIREMENTS = [
  "Passport valid for at least 6 months after arrival",
  "Passport photo (uploaded during booking)",
  "Return or onward flight ticket",
];

const NOT_INCLUDED = [
  "Government visa fees",
  "Personal expenses",
];

const DESCRIPTION =
  "Fast-track immigration and document handling for foreign tourists — a dedicated greeter meets you at the gate and walks you through every step of the arrival formalities.";

// ---------- package tiers (integer USD cents, per_pax) ----------
// In the same ballpark as the legacy VIP catalog ($30–$175 per pax).
const TIERS = [
  { label: "Fast Track", adultUsdCents: 3500, childUsdCents: 2500, sortOrder: 0 },
  { label: "VIP + Lounge", adultUsdCents: 7500, childUsdCents: 5000, sortOrder: 1 },
];

async function main() {
  // --- the vip-service line + its fast-track service type
  const line = await db.orm.public.ServiceLine
    .select("id")
    .where({ slug: "vip-service" })
    .first();
  if (!line) throw new Error("vip-service line missing — run `npm run db:seed` first.");

  const fastTrack = await db.orm.public.ServiceType
    .select("id")
    .where({ lineId: line.id, slug: "fast-track" })
    .first();
  if (!fastTrack) throw new Error("fast-track service type missing — run `npm run db:seed` first.");

  // --- visual identity copied from an existing VIP product, when available
  const legacyVip = await db.orm.public.Product
    .select("id", "slug", "imageUrl", "tone", "active", "isAddOn")
    .where((f) => f.lineId.eq(line.id))
    .all();
  const donor =
    legacyVip.find((p) => p.slug === "meet-greet" && p.imageUrl) ??
    legacyVip.find((p) => !p.isAddOn && p.imageUrl);
  const imageUrl = donor?.imageUrl ?? null;
  const tone = donor?.tone ?? "from-sky-400 to-blue-600";

  // --- every active airport with an IATA code gets ONE product
  const airports = await db.orm.public.Airport
    .select("id", "name", "city", "iataCode")
    .where((f) => f.active.eq(true))
    .where((f) => f.kind.eq("airport"))
    .orderBy((f) => f.city.asc())
    .all();

  const airportProductIds: string[] = [];

  for (const airport of airports) {
    if (!airport.iataCode) continue;
    const slug = `airport-vip-${airport.iataCode.toLowerCase()}`;

    const existing = await db.orm.public.Product.select("id").where({ slug }).first();
    let productId: string;
    if (existing) {
      productId = existing.id;
      bump("Product", "existing");
    } else {
      const created = await db.orm.public.Product.create({
        id: crypto.randomUUID(),
        slug,
        lineId: line.id,
        serviceTypeId: fastTrack.id,
        airportId: airport.id,
        title: "Airport VIP Service",
        description: DESCRIPTION,
        direction: "both",
        leadTimeHours: 24,
        included: INCLUDED,
        notIncluded: NOT_INCLUDED,
        requirements: REQUIREMENTS,
        imageUrl,
        tone,
        fromPriceUsdCents: TIERS[0]!.adultUsdCents,
      });
      productId = created.id;
      bump("Product", "created");
    }
    airportProductIds.push(productId);

    // --- the two package tiers (find-or-create by productId + label)
    for (const tier of TIERS) {
      const existingPkg = await db.orm.public.ProductPackage
        .select("id")
        .where({ productId, label: tier.label })
        .first();
      if (existingPkg) {
        bump("ProductPackage", "existing");
        continue;
      }
      await db.orm.public.ProductPackage.create({
        id: crypto.randomUUID(),
        productId,
        label: tier.label,
        unitKind: "per_pax",
        adultUsdCents: tier.adultUsdCents,
        childUsdCents: tier.childUsdCents,
        infantUsdCents: 0,
        sortOrder: tier.sortOrder,
      });
      bump("ProductPackage", "created");
    }
  }

  // --- the shared VOA handling add-on
  const voaSlug = "voa-handling";
  const existingVoa = await db.orm.public.Product.select("id").where({ slug: voaSlug }).first();
  let voaId: string;
  if (existingVoa) {
    voaId = existingVoa.id;
    bump("Product", "existing");
  } else {
    const created = await db.orm.public.Product.create({
      id: crypto.randomUUID(),
      slug: voaSlug,
      lineId: line.id,
      title: "Visa on Arrival handling",
      description:
        "We prepare and submit your Visa on Arrival paperwork before you land — meet the greeter with your documents ready.",
      isAddOn: true,
      fromPriceUsdCents: 3500,
      tone: "from-violet-400 to-purple-600",
    });
    voaId = created.id;
    bump("Product", "created");
  }

  // --- link the add-on to every airport product
  for (const productId of airportProductIds) {
    const existingEdge = await db.orm.public.ProductAddOn
      .select("id")
      .where({ productId, addOnId: voaId })
      .first();
    if (existingEdge) {
      bump("ProductAddOn", "existing");
      continue;
    }
    await db.orm.public.ProductAddOn.create({
      id: crypto.randomUUID(),
      productId,
      addOnId: voaId,
      sortOrder: 0,
    });
    bump("ProductAddOn", "created");
  }

  // --- deactivate legacy vip-service products (explicit updates; the main
  // seed is insert-only). Add-ons and the new airport products stay active;
  // historical bookings keep their foreign keys.
  const legacyActive = await db.orm.public.Product
    .select("id", "slug")
    .where((f) => f.lineId.eq(line.id))
    .where((f) => f.isAddOn.eq(false))
    .where((f) => f.active.eq(true))
    .all();
  for (const product of legacyActive) {
    if (product.slug.startsWith("airport-vip-")) continue;
    await db.orm.public.Product
      .where({ id: product.id })
      .update({ active: false });
    bump("Product (deactivated)", "updated");
    console.log(`  deactivated legacy product: ${product.slug}`);
  }

  // ---------- summary ----------
  console.log("\nAirport VIP seed complete:");
  for (const [table, c] of Object.entries(counts)) {
    console.log(
      `  ${table}: ${c.created} created, ${c.existing} existing, ${c.updated} updated`,
    );
  }
  console.log(`  airports covered: ${airportProductIds.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
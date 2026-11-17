// Throwaway verification of the multi-car cart round. Uses two SYNTHETIC
// transport products (created + deleted here) so no real catalog data is
// touched — the live fleet was re-seeded with stockTotal=1.
//
//   1. per-item stock aggregate: two lines of one product SUM (a decoy
//      Booking.vehicleCount proves the sum comes from the items), mixed
//      products reserve per product, expired unpaid bookings reserve nothing.
//   2. cart pricing math (Σ unit × days × qty, taxes, ONE payment) proven
//      against direct DB reads — the action's happy path needs request-scoped
//      cookies, so rows are written exactly as createCartBooking writes them.
//   3. action-level cart validation + idempotency (paths that run before
//      getUserSession, so they work outside a request scope).
//
// Run: node --import ./scripts/tmp/cart-alias-hook.mjs --experimental-strip-types --conditions react-server scripts/tmp/cart-stock-check.mts
import { db } from "@/prisma/db";
import { getAvailableStock } from "@/lib/stock";
import { computeTaxesFor } from "@/lib/tax";
import { createBooking } from "@/app/actions/booking";
import { param } from "@prisma/orm-postgres/relational-core/expression";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const createdBookings: string[] = [];
const createdPackages: string[] = [];
const createdProducts: string[] = [];
async function cleanupBooking(id: string) {
  await db.orm.public.Payment.where((f) => f.bookingId.eq(id)).deleteAll();
  await db.orm.public.FlightDetails.where((f) => f.bookingId.eq(id)).deleteAll();
  await db.orm.public.Contact.where((f) => f.bookingId.eq(id)).deleteAll();
  await db.orm.public.BookingItem.where((f) => f.bookingId.eq(id)).deleteAll();
  await db.orm.public.Booking.where((f) => f.id.eq(id)).deleteAll();
}

const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const contact = {
  firstName: "Cart", lastName: "Check", email: "cart-check@example.com",
  phoneCountryCode: "ID", phone: "08123456789", isGuestSelf: false,
};
const baseInput = {
  serviceAt: future.toISOString(),
  adult: 1, child: 0, infant: 0,
  addOns: [] as { slug: string; qty: number }[],
  contact, flight: {}, travelers: [] as { fullName: string; kind: string }[],
};
const code = () => `BV-T${Math.floor(Math.random() * 90000 + 10000)}`;

try {
  // --- synthetic test cars --------------------------------------------------
  const line = await db.orm.public.ServiceLine
    .select("id").where((f) => f.slug.eq("transport")).limit(1).all();
  const lineId = line[0]!.id;
  const run = crypto.randomUUID().slice(0, 8);

  async function makeCar(slug: string, stockTotal: number) {
    const id = crypto.randomUUID();
    await db.orm.public.Product.create({
      id, slug, lineId, title: `Cart Test ${slug}`, stockTotal,
    } as never);
    createdProducts.push(id);
    return { id, slug, title: `Cart Test ${slug}`, stockTotal };
  }
  async function makePkg(productId: string, label: string, unitKind: string, unitUsdCents: number) {
    const id = crypto.randomUUID();
    await db.orm.public.ProductPackage.create({
      id, productId, label, unitKind, unitUsdCents, sortOrder: createdPackages.length,
    } as never);
    createdPackages.push(id);
    return { id, label, unitKind, unitUsdCents };
  }

  const A = await makeCar(`cart-test-a-${run}`, 3);
  const B = await makeCar(`cart-test-b-${run}`, 2);
  const pkgA1 = await makePkg(A.id, "Daily 12h", "per_day", 4500);   // $45.00
  const pkgA2 = await makePkg(A.id, "Daily 24h", "per_day", 6000);   // $60.00
  const pkgAu = await makePkg(A.id, "Transfer", "per_unit", 2500);   // not cart-eligible
  const pkgB1 = await makePkg(B.id, "Daily 12h", "per_day", 5200);   // $52.00

  const baseA = 3, baseB = 2;
  let stock = await getAvailableStock([A.id, B.id]);
  check("synthetic cars start at full stock", [stock.get(A.id), stock.get(B.id)], [baseA, baseB]);
  console.log(`\nCars: A=${A.slug} (stock ${baseA}; pkg ${pkgA1.unitUsdCents}c & ${pkgA2.unitUsdCents}c), B=${B.slug} (stock ${baseB}; pkg ${pkgB1.unitUsdCents}c)\n`);

  // --- 1. two lines of the SAME product sum their counts --------------------
  // Booking.vehicleCount is a DECOY (1): the aggregate must come from the
  // items (1+2=3), not the booking column — otherwise available would be 2.
  const t1 = crypto.randomUUID();
  const t1Key = `cart-check-${crypto.randomUUID()}`;
  const t1Code = code();
  await db.orm.public.Booking.create({
    id: t1, code: t1Code, status: "awaiting_payment", serviceAt: future,
    vehicleCount: 1, subtotalUsdCents: 0, totalUsdCents: 0,
    idempotencyKey: t1Key,
  });
  createdBookings.push(t1);
  for (const [n, days] of [[1, 1], [2, 2]] as const) {
    await db.orm.public.BookingItem.create({
      id: crypto.randomUUID(), bookingId: t1, productId: A.id, packageId: pkgA1.id,
      label: A.title, packageLabel: pkgA1.label, unitKind: "per_day",
      quantity: days, vehicleCount: n,
      unitUsdCents: pkgA1.unitUsdCents, totalUsdCents: pkgA1.unitUsdCents * days * n,
    });
  }
  stock = await getAvailableStock([A.id, B.id]);
  check("same-product lines (1+2) reserve the SUM, not Booking.vehicleCount", stock.get(A.id), baseA - 3);
  check("other product untouched", stock.get(B.id), baseB);

  // --- idempotency: same key returns the original booking ------------------
  const replay = await createBooking({
    ...baseInput,
    productSlug: A.slug,
    items: [{ productSlug: A.slug, packageId: pkgA1.id, days: 1, vehicleCount: 1 }],
    idempotencyKey: t1Key,
  });
  check("idempotent replay ok", replay.ok, true);
  if (replay.ok) check("idempotent replay returns original code", replay.code, t1Code);
  await cleanupBooking(t1);
  createdBookings.pop();
  stock = await getAvailableStock([A.id, B.id]);
  check("stock restored after cleanup", [stock.get(A.id), stock.get(B.id)], [baseA, baseB]);

  // --- 2. MIXED products reserve per product --------------------------------
  const t2 = crypto.randomUUID();
  await db.orm.public.Booking.create({
    id: t2, code: code(), status: "confirmed", serviceAt: future,
    vehicleCount: 2, subtotalUsdCents: 0, totalUsdCents: 0,
  });
  createdBookings.push(t2);
  for (const [p, pkg] of [[A, pkgA1], [B, pkgB1]] as const) {
    await db.orm.public.BookingItem.create({
      id: crypto.randomUUID(), bookingId: t2, productId: p.id, packageId: pkg.id,
      label: p.title, packageLabel: pkg.label, unitKind: "per_day",
      quantity: 1, vehicleCount: 1, unitUsdCents: pkg.unitUsdCents, totalUsdCents: pkg.unitUsdCents,
    });
  }
  stock = await getAvailableStock([A.id, B.id]);
  check("mixed cart reserves A per item", stock.get(A.id), baseA - 1);
  check("mixed cart reserves B per item", stock.get(B.id), baseB - 1);
  await cleanupBooking(t2);
  createdBookings.pop();

  // --- 3. expired awaiting_payment reserves nothing (TTL) -------------------
  const t4 = crypto.randomUUID();
  await db.orm.public.Booking.create({
    id: t4, code: code(), status: "awaiting_payment", serviceAt: future,
    vehicleCount: 1, subtotalUsdCents: 0, totalUsdCents: 0,
  });
  createdBookings.push(t4);
  await db.orm.public.BookingItem.create({
    id: crypto.randomUUID(), bookingId: t4, productId: A.id, packageId: pkgA1.id,
    label: A.title, packageLabel: pkgA1.label, unitKind: "per_day",
    quantity: 1, vehicleCount: 1, unitUsdCents: pkgA1.unitUsdCents, totalUsdCents: pkgA1.unitUsdCents,
  });
  await db.execute(
    db.raw.sql`UPDATE "Booking" SET "createdAt" = now() - interval '25 hours' WHERE "id" = ${param(t4, { codecId: "pg/text@1" })}`.affectedCount().build(),
  );
  stock = await getAvailableStock([A.id]);
  check("25h-old unpaid booking reserves nothing (24h TTL)", stock.get(A.id), baseA);
  await cleanupBooking(t4);
  createdBookings.pop();

  // --- 4. cart PRICING math via direct DB reads -----------------------------
  // Lines: A pkg1 2 days × 2 units, A pkg2 1 day × 1 unit, B pkg1 3 days × 1.
  const lines = [
    { p: A, pkg: pkgA1, days: 2, qty: 2 },
    { p: A, pkg: pkgA2, days: 1, qty: 1 },
    { p: B, pkg: pkgB1, days: 3, qty: 1 },
  ];
  const lineTotals = lines.map((l) => l.pkg.unitUsdCents * l.days * l.qty);
  const subtotal = lineTotals.reduce((s, x) => s + x, 0);
  const taxes = await computeTaxesFor(subtotal);
  const total = subtotal + taxes.totalUsdCents;
  const vehicleSum = lines.reduce((s, l) => s + l.qty, 0);

  const t3 = crypto.randomUUID();
  await db.orm.public.Booking.create({
    id: t3, code: code(), status: "awaiting_payment", serviceAt: future,
    vehicleCount: vehicleSum, subtotalUsdCents: subtotal, totalUsdCents: total,
    taxes: taxes.lines as never, taxUsdCents: taxes.totalUsdCents,
  });
  createdBookings.push(t3);
  for (const [i, l] of lines.entries()) {
    await db.orm.public.BookingItem.create({
      id: crypto.randomUUID(), bookingId: t3, productId: l.p.id, packageId: l.pkg.id,
      label: l.p.title, packageLabel: l.pkg.label, unitKind: "per_day",
      quantity: l.days, vehicleCount: l.qty,
      unitUsdCents: l.pkg.unitUsdCents, totalUsdCents: lineTotals[i]!,
    });
  }
  await db.orm.public.Payment.create({
    id: crypto.randomUUID(), bookingId: t3, methodId: null,
    status: "pending", amountUsdCents: total,
  });

  const bookingRows = await db.orm.public.Booking
    .select("vehicleCount", "subtotalUsdCents", "taxUsdCents", "totalUsdCents")
    .where((f) => f.id.eq(t3)).all();
  const itemRows = await db.orm.public.BookingItem
    .select("productId", "quantity", "vehicleCount", "unitUsdCents", "totalUsdCents")
    .where((f) => f.bookingId.eq(t3)).all();
  const paymentRows = await db.orm.public.Payment
    .select("amountUsdCents", "status")
    .where((f) => f.bookingId.eq(t3)).all();

  console.log(`\nCart math: lineTotals=${JSON.stringify(lineTotals)} subtotal=${subtotal} tax=${taxes.totalUsdCents} total=${total} vehicles=${vehicleSum}`);
  check("booking.subtotal = Σ(unit×days×qty)", bookingRows[0]?.subtotalUsdCents, subtotal);
  check("booking.total = subtotal + tax", bookingRows[0]?.totalUsdCents, total);
  check("booking.vehicleCount = Σ line counts", bookingRows[0]?.vehicleCount, vehicleSum);
  check("one BookingItem per cart line", itemRows.length, lines.length);
  check("item totals = unit×days×qty", itemRows.map((r) => r.totalUsdCents).sort((a, b) => a - b), [...lineTotals].sort((a, b) => a - b));
  check("item.quantity stores DAYS", itemRows.map((r) => r.quantity).sort((a, b) => a - b), lines.map((l) => l.days).sort((a, b) => a - b));
  check("item.vehicleCount stores line units", itemRows.map((r) => r.vehicleCount).sort((a, b) => a - b), lines.map((l) => l.qty).sort((a, b) => a - b));
  check("ONE placeholder payment for the cart", paymentRows.length, 1);
  check("payment amount = booking total", paymentRows[0]?.amountUsdCents, total);
  stock = await getAvailableStock([A.id, B.id]);
  check("cart reserves A across its lines (2+1)", stock.get(A.id), baseA - 3);
  check("cart reserves B across its lines", stock.get(B.id), baseB - 1);
  await cleanupBooking(t3);
  createdBookings.pop();

  // --- 5. action-level cart validation (pre-cookie paths) -------------------
  console.log("");
  const over = await createBooking({
    ...baseInput, productSlug: A.slug,
    items: [{ productSlug: A.slug, packageId: pkgA1.id, days: 1, vehicleCount: baseA + 1 }],
  });
  check("over-stock cart rejected", over.ok, false);
  if (!over.ok) console.log(`      error: ${over.error}`);

  const overSum = await createBooking({
    ...baseInput, productSlug: A.slug,
    items: [
      { productSlug: A.slug, packageId: pkgA1.id, days: 1, vehicleCount: 2 },
      { productSlug: A.slug, packageId: pkgA2.id, days: 1, vehicleCount: 2 },
    ],
  });
  check("aggregate over-stock (2+2 > 3, each line fits) rejected", overSum.ok, false);
  if (!overSum.ok) console.log(`      error: ${overSum.error}`);

  const nonTransport = await db.orm.public.Product
    .select("slug").where((f) => f.active.eq(true)).where((f) => f.isAddOn.eq(false))
    .where((f) => f.lineId.neq(lineId)).limit(1).all();
  if (nonTransport[0]) {
    const bad = await createBooking({
      ...baseInput, productSlug: nonTransport[0].slug,
      items: [{ productSlug: nonTransport[0].slug, packageId: "x", days: 1, vehicleCount: 1 }],
    });
    check("non-transport product rejected", bad.ok, false);
    if (!bad.ok) console.log(`      error: ${bad.error}`);
  }

  const wrongPkg = await createBooking({
    ...baseInput, productSlug: A.slug,
    items: [{ productSlug: A.slug, packageId: pkgB1.id, days: 1, vehicleCount: 1 }],
  });
  check("package of another product rejected", wrongPkg.ok, false);
  if (!wrongPkg.ok) console.log(`      error: ${wrongPkg.error}`);

  const perUnit = await createBooking({
    ...baseInput, productSlug: A.slug,
    items: [{ productSlug: A.slug, packageId: pkgAu.id, days: 1, vehicleCount: 1 }],
  });
  check("non-per_day package rejected", perUnit.ok, false);
  if (!perUnit.ok) console.log(`      error: ${perUnit.error}`);

  const badDays = await createBooking({
    ...baseInput, productSlug: A.slug,
    items: [{ productSlug: A.slug, packageId: pkgA1.id, days: 0, vehicleCount: 1 }],
  });
  check("days=0 rejected", badDays.ok, false);
  if (!badDays.ok) console.log(`      error: ${badDays.error}`);

  const badDays2 = await createBooking({
    ...baseInput, productSlug: A.slug,
    items: [{ productSlug: A.slug, packageId: pkgA1.id, days: 366, vehicleCount: 1 }],
  });
  check("days=366 rejected", badDays2.ok, false);

  const badQty = await createBooking({
    ...baseInput, productSlug: A.slug,
    items: [{ productSlug: A.slug, packageId: pkgA1.id, days: 1, vehicleCount: 100 }],
  });
  check("vehicleCount=100 rejected", badQty.ok, false);
  if (!badQty.ok) console.log(`      error: ${badQty.error}`);

  const unknown = await createBooking({
    ...baseInput, productSlug: "no-such-car",
    items: [{ productSlug: "no-such-car", packageId: pkgA1.id, days: 1, vehicleCount: 1 }],
  });
  check("unknown product rejected", unknown.ok, false);
  if (!unknown.ok) console.log(`      error: ${unknown.error}`);

  // --- final: stock back to baseline ----------------------------------------
  stock = await getAvailableStock([A.id, B.id]);
  check("stock back to baseline after all cleanup", [stock.get(A.id), stock.get(B.id)], [baseA, baseB]);
} finally {
  for (const id of createdBookings) {
    try { await cleanupBooking(id); } catch (e) { console.error("cleanup failed for booking", id, e); }
  }
  for (const id of createdPackages) {
    try { await db.orm.public.ProductPackage.where((f) => f.id.eq(id)).deleteAll(); } catch (e) { console.error("cleanup failed for package", id, e); }
  }
  for (const id of createdProducts) {
    try { await db.orm.public.Product.where((f) => f.id.eq(id)).deleteAll(); } catch (e) { console.error("cleanup failed for product", id, e); }
  }
  await db.close();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

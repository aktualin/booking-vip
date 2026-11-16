// One-off cleanup: remove the seeded transport reviews + their dedicated
// reviewer users, and clear the rating summary on the transport fleet.
// Run: node --experimental-strip-types scripts/tmp/cleanup-transport-reviews.mts
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

// 1. Delete the deterministic seed reviews.
const allReviews = await db.orm.public.Review.select("id").where({ subjectType: "product" }).all();
const reviewIds = allReviews.map((r) => r.id).filter((id) => id.startsWith("seed-transport-review-"));
if (reviewIds.length > 0) {
  await db.orm.public.Review.where((f) => f.id.in(reviewIds)).deleteAll();
}
console.log("deleted seed reviews:", reviewIds.length);

// 2. Delete the dedicated seed reviewer users (created only for those reviews).
const allUsers = await db.orm.public.User.select("id").all();
const userIds = allUsers.map((u) => u.id).filter((id) => id.startsWith("seed-transport-user-"));
if (userIds.length > 0) {
  await db.orm.public.User.where((f) => f.id.in(userIds)).deleteAll();
}
console.log("deleted seed reviewer users:", userIds.length);

// 3. Clear the rating summary on every transport product.
const line = await db.orm.public.ServiceLine.select("id").where({ slug: "transport" }).first();
const cars = await db.orm.public.Product.select("id").where({ lineId: line.id }).all();
for (const c of cars) {
  await db.orm.public.Product.where({ id: c.id }).update({ rating: null, reviews: 0 } as never);
}
console.log("cleared rating on transport products:", cars.length);
process.exit(0);
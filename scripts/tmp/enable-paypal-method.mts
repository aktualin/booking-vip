// Enable the PayPal payment method WITHOUT running the full seed (other
// agents own the tour/content seed). Upserts only the PAYPAL PaymentMethod
// row; everything else is left untouched. PayPal is the second gateway
// (provider "paypal"), sitting right after the Xendit credit-card method
// (CREDIT_CARD sortOrder=20, EWALLET sortOrder=30 → PAYPAL takes 25).
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/enable-paypal-method.mts
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

const method = {
  code: "PAYPAL",
  label: "PayPal — bayar dengan akun PayPal (USD)",
  providerMethodCode: "PAYPAL",
  sortOrder: 25,
};

try {
  const existing = await db.orm.public.PaymentMethod
    .select("id")
    .where({ code: method.code })
    .first();

  if (existing) {
    await db.orm.public.PaymentMethod.where({ id: existing.id }).update({
      label: method.label,
      provider: "paypal",
      providerMethodCode: method.providerMethodCode,
      active: true,
    });
    console.log(`updated ${method.code} → paypal/${method.providerMethodCode}, active`);
  } else {
    await db.orm.public.PaymentMethod.create({
      id: crypto.randomUUID(),
      code: method.code,
      label: method.label,
      provider: "paypal",
      providerMethodCode: method.providerMethodCode,
      sortOrder: method.sortOrder,
      active: true,
    });
    console.log(`created ${method.code} → paypal/${method.providerMethodCode}, active`);
  }

  const rows = await db.orm.public.PaymentMethod
    .select("code", "provider", "providerMethodCode", "active")
    .orderBy((f) => f.sortOrder.asc())
    .all();
  console.log("PaymentMethod rows now:");
  for (const row of rows) {
    console.log(`  ${row.code.padEnd(15)} provider=${row.provider ?? "-"} method=${row.providerMethodCode ?? "-"} active=${row.active}`);
  }
} catch (error) {
  console.error("ERROR:", error);
  process.exitCode = 1;
} finally {
  await db.close();
}

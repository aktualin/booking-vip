// Re-enable the QRIS payment method (Xendit hosted checkout) — the picker
// now offers Credit Card + QRIS; PayPal stays the express button only.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/enable-qris.mts
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

try {
  const existing = await db.orm.public.PaymentMethod
    .select("id")
    .where({ code: "QRIS" })
    .first();

  if (existing) {
    await db.orm.public.PaymentMethod.where({ id: existing.id }).update({
      provider: "xendit",
      providerMethodCode: "QRIS",
      active: true,
    });
    console.log("reactivated QRIS → xendit/QRIS");
  } else {
    await db.orm.public.PaymentMethod.create({
      id: crypto.randomUUID(),
      code: "QRIS",
      label: "QRIS — scan dengan aplikasi apa pun",
      provider: "xendit",
      providerMethodCode: "QRIS",
      sortOrder: 40,
      active: true,
    });
    console.log("created QRIS → xendit/QRIS, active");
  }

  const rows = await db.orm.public.PaymentMethod
    .select("code", "provider", "providerMethodCode", "active")
    .orderBy((f) => f.sortOrder.asc())
    .all();
  console.log("PaymentMethod rows now:");
  for (const row of rows) {
    console.log(
      `  ${row.code.padEnd(15)} provider=${row.provider ?? "-"} method=${row.providerMethodCode ?? "-"} active=${row.active}`,
    );
  }
} catch (error) {
  console.error("ERROR:", error);
  process.exitCode = 1;
} finally {
  await db.close();
}

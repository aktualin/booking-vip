// Retire the Virtual Account (BANK_TRANSFER) and QRIS payment methods —
// only Credit Card and PayPal remain selectable. Deactivates the rows (kept
// for historical payments) without running the full seed.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/disable-va-qris.mts
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

try {
  for (const code of ["QRIS", "BANK_TRANSFER"]) {
    const res = await db.orm.public.PaymentMethod.where({ code }).update({
      active: false,
    });
    console.log(`deactivated ${code} (${res.rowsAffected} row(s))`);
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

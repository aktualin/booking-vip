// Enable the Xendit QRIS + Virtual Account payment channels WITHOUT running
// the full seed (other agents own the tour/content seed). Upserts only the
// two PaymentMethod rows; everything else is left untouched.
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/enable-xendit-channels.mts
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";

const channels = [
  {
    code: "QRIS",
    label: "QRIS — scan dengan aplikasi apa pun",
    providerMethodCode: "QRIS",
    sortOrder: 40,
  },
  {
    code: "BANK_TRANSFER",
    label: "Virtual Account — BCA, Mandiri, BNI, BRI, BSI, Permata",
    providerMethodCode: "VIRTUAL_ACCOUNT",
    sortOrder: 10,
  },
];

try {
  for (const channel of channels) {
    const existing = await db.orm.public.PaymentMethod
      .select("id")
      .where({ code: channel.code })
      .first();

    if (existing) {
      await db.orm.public.PaymentMethod.where({ id: existing.id }).update({
        label: channel.label,
        provider: "xendit",
        providerMethodCode: channel.providerMethodCode,
        active: true,
      });
      console.log(`updated ${channel.code} → xendit/${channel.providerMethodCode}, active`);
    } else {
      await db.orm.public.PaymentMethod.create({
        id: crypto.randomUUID(),
        code: channel.code,
        label: channel.label,
        provider: "xendit",
        providerMethodCode: channel.providerMethodCode,
        sortOrder: channel.sortOrder,
        active: true,
      });
      console.log(`created ${channel.code} → xendit/${channel.providerMethodCode}, active`);
    }
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
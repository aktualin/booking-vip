// Throwaway audit: prove the cancelled wallet feature left NO trace in the
// database — no WalletTransaction table, no User.walletBalanceUsdCents
// column, no PaymentMethod with code 'WALLET'.
//
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/wallet-db-audit.mts
import { db } from "@/prisma/db";

const walletTable = await db.query(
  db.raw.sql`
    SELECT count(*)::int4 AS n
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'WalletTransaction'
  `.returnsRow({ n: "pg/int4@1" }).build(),
);

const walletColumn = await db.query(
  db.raw.sql`
    SELECT count(*)::int4 AS n
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name = 'walletBalanceUsdCents'
  `.returnsRow({ n: "pg/int4@1" }).build(),
);

const walletMethod = await db.query(
  db.raw.sql`
    SELECT count(*)::int4 AS n
    FROM "PaymentMethod"
    WHERE code = 'WALLET'
  `.returnsRow({ n: "pg/int4@1" }).build(),
);

const results = [
  ['WalletTransaction table absent', walletTable[0]?.n === 0],
  ['User.walletBalanceUsdCents column absent', walletColumn[0]?.n === 0],
  ["No PaymentMethod code='WALLET'", walletMethod[0]?.n === 0],
] as const;

let failures = 0;
for (const [name, ok] of results) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(failures === 0 ? "WALLET DB AUDIT: ALL PASS ✅" : `WALLET DB AUDIT: ${failures} FAILURES ❌`);
process.exit(failures === 0 ? 0 : 1);

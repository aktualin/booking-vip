#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1ae23f0067f0afa5978542c0eb38feda37bbb6da283163f4b49f3914f99194fd/contract';
import endContract from '../../snapshots/1ae23f0067f0afa5978542c0eb38feda37bbb6da283163f4b49f3914f99194fd/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/541e69033de9055ab8e2d0ca4e9d8402202ab3841087ee53cdaf36f1520163b2/contract';
import startContract from '../../snapshots/541e69033de9055ab8e2d0ca4e9d8402202ab3841087ee53cdaf36f1520163b2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';

// Lazy façade over the END contract: constructing it opens no connection. Its
// `sql`/`raw` builders and the validated `contract` are what the data transforms
// below build their plans against (storage hashes must match `endContract`).
const { sql: db, raw, contract } = postgres({ contract: contractFromJson<End>(endContract) });

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // Normalize historical DOKU payments before any destructive drop: they
      // stored providerAmountCents in IDR cents; rewrite them to USD cents
      // (= amountUsdCents). Raw lane; check is a rowset (runner wraps EXISTS).
      this.dataTransform(contract, 'normalize-doku-payment-amounts', {
        check: () =>
          raw.sql`SELECT "id" FROM "Payment" WHERE "provider" = 'doku' AND "providerAmountCents" IS DISTINCT FROM "amountUsdCents" LIMIT 1`
            .returnsRow({ id: 'pg/text@1' })
            .build(),
        run: () =>
          raw.sql`UPDATE "Payment" SET "providerAmountCents" = "amountUsdCents" WHERE "provider" = 'doku' AND "providerAmountCents" IS DISTINCT FROM "amountUsdCents"`
            .affectedCount()
            .build(),
      }),
      // Retire the IDR-only QRIS method and point CREDIT_CARD at Xendit. Typed
      // plans against the end contract (PaymentMethod survives the drops).
      // `provider IS DISTINCT FROM 'xendit'` == (provider != 'xendit' OR provider IS NULL).
      this.dataTransform(contract, 'payment-methods-xendit-usd', {
        check: () =>
          db.public.PaymentMethod.select('id')
            .where((f, fns) =>
              fns.or(
                fns.and(fns.eq(f.code, 'QRIS'), fns.eq(f.active, true)),
                fns.and(
                  fns.eq(f.code, 'CREDIT_CARD'),
                  fns.or(fns.ne(f.provider, 'xendit'), fns.eq(f.provider, null)),
                ),
              ),
            )
            .limit(1)
            .build(),
        run: [
          () =>
            db.public.PaymentMethod.update({ active: false })
              .where((f, fns) => fns.eq(f.code, 'QRIS'))
              .build(),
          () =>
            db.public.PaymentMethod.update({ provider: 'xendit' })
              .where((f, fns) => fns.eq(f.code, 'CREDIT_CARD'))
              .build(),
        ],
      }),
      this.dropColumn({ schema: 'public', table: 'Booking', column: 'currencyCode' }),
      this.dropColumn({ schema: 'public', table: 'Booking', column: 'fxRate' }),
      this.dropTable({ schema: 'public', table: 'ExchangeRate' }),
      this.dropTable({ schema: 'public', table: 'Currency' }),
      this.dropColumn({ schema: 'public', table: 'Payment', column: 'currencyCode' }),
      this.dropColumn({ schema: 'public', table: 'Payment', column: 'fxRate' }),
      this.dropColumn({ schema: 'public', table: 'Payment', column: 'providerCurrency' }),
      this.dropColumn({ schema: 'public', table: 'PaymentMethod', column: 'providerCurrency' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

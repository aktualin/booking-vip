#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/19a031fdfd1890b629fc6b9006eec08cff45605b6b0cb25ee51752afe1e647aa/contract';
import endContract from '../../snapshots/19a031fdfd1890b629fc6b9006eec08cff45605b6b0cb25ee51752afe1e647aa/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/1ae23f0067f0afa5978542c0eb38feda37bbb6da283163f4b49f3914f99194fd/contract';
import startContract from '../../snapshots/1ae23f0067f0afa5978542c0eb38feda37bbb6da283163f4b49f3914f99194fd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Payment',
        column: col('fxRate', 'float8', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/float8@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Payment',
        column: col('providerCurrency', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/19a031fdfd1890b629fc6b9006eec08cff45605b6b0cb25ee51752afe1e647aa/contract';
import startContract from '../../snapshots/19a031fdfd1890b629fc6b9006eec08cff45605b6b0cb25ee51752afe1e647aa/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/8ba64b55cbaba8c6168df76a84fd89a60b8deee71ccdd53ef184eeb000f24c9d/contract';
import endContract from '../../snapshots/8ba64b55cbaba8c6168df76a84fd89a60b8deee71ccdd53ef184eeb000f24c9d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Booking',
        column: col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Booking',
        column: col('vehicleCount', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Product',
        column: col('stockTotal', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'Booking',
        index: 'Booking_idempotencyKey_key',
        columns: ['idempotencyKey'],
        extras: { unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

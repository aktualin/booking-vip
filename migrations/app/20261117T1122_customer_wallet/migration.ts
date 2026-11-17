#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5cde9037763d17937675a4282ecaaec0863cfaca69f792d7cbddd0baadff88a3/contract';
import endContract from '../../snapshots/5cde9037763d17937675a4282ecaaec0863cfaca69f792d7cbddd0baadff88a3/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9299c5d71e5fec1f5b346e9c181e082ada1eea6d45b029789216886be3ddb890/contract';
import startContract from '../../snapshots/9299c5d71e5fec1f5b346e9c181e082ada1eea6d45b029789216886be3ddb890/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'WalletTransaction',
        columns: [
          col('amountUsdCents', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('balanceAfterUsdCents', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('bookingId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'User',
        column: col('walletBalanceUsdCents', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'WalletTransaction',
        index: 'WalletTransaction_bookingId_kind_key',
        columns: ['bookingId', 'kind'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'WalletTransaction',
        index: 'WalletTransaction_userId_createdAt_idx',
        columns: ['userId', 'createdAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'WalletTransaction',
        foreignKey: {
          name: 'WalletTransaction_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0df10fda98737dfdf2f45840be645c36312159758bfa6b085803eee39da99641/contract';
import endContract from '../../snapshots/0df10fda98737dfdf2f45840be645c36312159758bfa6b085803eee39da99641/contract.json' with { type: 'json' };
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
        table: 'ContractClause',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('body', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sortOrder', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'SignedContract',
        columns: [
          col('bookingId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('clausesSnapshot', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('signatureUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('signedAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('signerName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ContractClause',
        index: 'ContractClause_sortOrder_idx',
        columns: ['sortOrder'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'SignedContract',
        index: 'SignedContract_bookingId_key',
        columns: ['bookingId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'SignedContract',
        index: 'SignedContract_signedAt_idx',
        columns: ['signedAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'SignedContract',
        foreignKey: {
          name: 'SignedContract_bookingId_fkey',
          columns: ['bookingId'],
          references: { schema: 'public', table: 'Booking', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

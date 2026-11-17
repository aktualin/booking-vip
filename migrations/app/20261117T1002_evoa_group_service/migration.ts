#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6db9411d22fad86548751c9739ba2d788a8d389a75c8f384dbab652275a7817f/contract';
import endContract from '../../snapshots/6db9411d22fad86548751c9739ba2d788a8d389a75c8f384dbab652275a7817f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f61e394ec9a8510cdbfff48da413605d5824ebd4f24ae52d3a869e5c034556b8/contract';
import startContract from '../../snapshots/f61e394ec9a8510cdbfff48da413605d5824ebd4f24ae52d3a869e5c034556b8/contract.json' with { type: 'json' };
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
        table: 'EvoaFormField',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('helpEn', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('helpId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('labelEn', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('labelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('maxFiles', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('options', 'jsonb', {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('placeholderEn', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('placeholderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('required', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('scope', 'text', {
            notNull: true,
            default: lit('applicant'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('showWhen', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('sortOrder', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'EvoaStatusEvent',
        columns: [
          col('actor', 'text', {
            notNull: true,
            default: lit('system'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('actorEmail', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('applicantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('applicationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'VisaApplicant',
        columns: [
          col('applicationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('dateOfBirth', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('extraAnswers', 'jsonb', {
            notNull: true,
            default: lit({}),
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('fullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('gender', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('issuedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('nationality', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('passportExpiryDate', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('passportIssueDate', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('passportIssuingCountry', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('passportNumber', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('passportType', 'text', {
            notNull: true,
            default: lit('ordinary'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('phone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('placeOfBirth', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('relation', 'text', {
            notNull: true,
            default: lit('other'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('revisionNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sortOrder', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('pending'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('visaExpiresAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('visaNumber', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('visaPdfKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'VisaDocument',
        columns: [
          col('applicantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('applicationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
          }),
          col('fileName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mimeType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reviewNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reviewStatus', 'text', {
            notNull: true,
            default: lit('pending'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('sizeBytes', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('slot', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sortOrder', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('completedAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('contactName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('departureDate', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('departureFlightNumber', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('extraAnswers', 'jsonb', {
          notNull: true,
          default: lit({}),
          codecRef: { codecId: 'pg/jsonb@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('flightNumber', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('hotelAddress', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('hotelCity', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('hotelName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('hotelPostalCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('officialTransactionRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('paidAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('portOfEntryId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('portOfEntryName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('processingAt', 'timestamp(3)', {
          codecRef: { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('purpose', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'VisaApplication',
        column: col('revisionNote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dropNotNull({ schema: 'public', table: 'VisaApplication', column: 'dateOfBirth' }),
      this.dropNotNull({ schema: 'public', table: 'VisaApplication', column: 'fullName' }),
      this.dropNotNull({ schema: 'public', table: 'VisaApplication', column: 'nationality' }),
      this.dropNotNull({ schema: 'public', table: 'VisaApplication', column: 'passportNumber' }),
      this.addColumnWithTemporaryDefault({
        schema: 'public',
        table: 'VisaApplication',
        column: 'updatedAt',
        type: 'timestamp(3)',
        temporaryDefault: sql`'epoch'`,
      }),
      this.createIndex({
        schema: 'public',
        table: 'EvoaFormField',
        index: 'EvoaFormField_key_key',
        columns: ['key'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'EvoaStatusEvent',
        index: 'EvoaStatusEvent_applicationId_idx',
        columns: ['applicationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'EvoaStatusEvent',
        index: 'EvoaStatusEvent_createdAt_idx',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'VisaApplicant',
        index: 'VisaApplicant_applicationId_idx',
        columns: ['applicationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'VisaApplicant',
        index: 'VisaApplicant_applicationId_passportNumber_key',
        columns: ['applicationId', 'passportNumber'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'VisaApplication',
        index: 'VisaApplication_status_idx',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'VisaDocument',
        index: 'VisaDocument_applicantId_idx',
        columns: ['applicantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'VisaDocument',
        index: 'VisaDocument_applicationId_idx',
        columns: ['applicationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'VisaDocument',
        index: 'VisaDocument_key_idx',
        columns: ['key'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'EvoaStatusEvent',
        foreignKey: {
          name: 'EvoaStatusEvent_applicationId_fkey',
          columns: ['applicationId'],
          references: { schema: 'public', table: 'VisaApplication', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'EvoaStatusEvent',
        foreignKey: {
          name: 'EvoaStatusEvent_applicantId_fkey',
          columns: ['applicantId'],
          references: { schema: 'public', table: 'VisaApplicant', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'VisaApplicant',
        foreignKey: {
          name: 'VisaApplicant_applicationId_fkey',
          columns: ['applicationId'],
          references: { schema: 'public', table: 'VisaApplication', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'VisaApplication',
        foreignKey: {
          name: 'VisaApplication_portOfEntryId_fkey',
          columns: ['portOfEntryId'],
          references: { schema: 'public', table: 'Airport', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'VisaDocument',
        foreignKey: {
          name: 'VisaDocument_applicationId_fkey',
          columns: ['applicationId'],
          references: { schema: 'public', table: 'VisaApplication', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'VisaDocument',
        foreignKey: {
          name: 'VisaDocument_applicantId_fkey',
          columns: ['applicantId'],
          references: { schema: 'public', table: 'VisaApplicant', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

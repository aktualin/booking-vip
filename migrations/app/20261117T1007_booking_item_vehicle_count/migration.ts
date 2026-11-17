#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/6db9411d22fad86548751c9739ba2d788a8d389a75c8f384dbab652275a7817f/contract';
import startContract from '../../snapshots/6db9411d22fad86548751c9739ba2d788a8d389a75c8f384dbab652275a7817f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9299c5d71e5fec1f5b346e9c181e082ada1eea6d45b029789216886be3ddb890/contract';
import endContract from '../../snapshots/9299c5d71e5fec1f5b346e9c181e082ada1eea6d45b029789216886be3ddb890/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';

// Lazy façade over the end contract — constructing it opens no connection;
// its raw lane builds query plans whose storage hash matches the transform.
const { raw, contract } = postgres({ contract: contractFromJson<End>(endContract) });

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'BookingItem',
        column: col('vehicleCount', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      // Backfill the per-line reservation count from the parent booking for
      // single-item bookings (every booking created before the cart existed
      // has exactly one item, so its Booking.vehicleCount is the line's
      // count). Multi-item bookings keep the default 1 per line — none exist
      // yet. Idempotent: rows already carrying the right count are skipped.
      this.dataTransform(contract, 'backfill-booking-item-vehicle-count', {
        backfillsColumn: { schema: 'public', table: 'BookingItem', column: 'vehicleCount' },
        check: () =>
          raw.sql`
            SELECT bi."id"
            FROM "BookingItem" bi
            JOIN "Booking" b ON b."id" = bi."bookingId"
            WHERE bi."vehicleCount" <> b."vehicleCount"
              AND (SELECT COUNT(*) FROM "BookingItem" x WHERE x."bookingId" = bi."bookingId") = 1
            LIMIT 1
          `.returnsRow({ id: 'pg/text@1' }).build(),
        run: () =>
          raw.sql`
            UPDATE "BookingItem" bi
            SET "vehicleCount" = b."vehicleCount"
            FROM "Booking" b
            WHERE bi."bookingId" = b."id"
              AND bi."vehicleCount" <> b."vehicleCount"
              AND (SELECT COUNT(*) FROM "BookingItem" x WHERE x."bookingId" = bi."bookingId") = 1
          `.affectedCount().build(),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

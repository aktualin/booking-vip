#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5cde9037763d17937675a4282ecaaec0863cfaca69f792d7cbddd0baadff88a3/contract';
import startContract from '../../snapshots/5cde9037763d17937675a4282ecaaec0863cfaca69f792d7cbddd0baadff88a3/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9299c5d71e5fec1f5b346e9c181e082ada1eea6d45b029789216886be3ddb890/contract';
import endContract from '../../snapshots/9299c5d71e5fec1f5b346e9c181e082ada1eea6d45b029789216886be3ddb890/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: 'public', table: 'User', column: 'walletBalanceUsdCents' }),
      this.dropTable({ schema: 'public', table: 'WalletTransaction' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/541e69033de9055ab8e2d0ca4e9d8402202ab3841087ee53cdaf36f1520163b2/contract';
import endContract from '../../snapshots/541e69033de9055ab8e2d0ca4e9d8402202ab3841087ee53cdaf36f1520163b2/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/61a63442ed422021f8abb61982e8ecd591a7ed97e53a012d0e9a85966a82267d/contract';
import startContract from '../../snapshots/61a63442ed422021f8abb61982e8ecd591a7ed97e53a012d0e9a85966a82267d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Contact',
        column: col('idDocumentUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Contact',
        column: col('idType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Contact',
        column: col('identityNumber', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Contact',
        column: col('signatureUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

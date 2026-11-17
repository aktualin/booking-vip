"use server";

import { db } from "@/prisma/db";
import { getAdminSession } from "@/lib/admin/session";

/**
 * The admin actions of the transport rental agreement articles.
 *
 * The articles live in the `ContractClause` table and are authored in
 * English — the signed agreement is an English contract and the public
 * agreement step renders the content as-is (no translation layer).
 */

export type ContractClauseDTO = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type ContractClauseResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: string };

const fail = (error: string, field?: string): ContractClauseResult => ({
  ok: false,
  error,
  field,
});

/** Every article, ordered the way the agreement numbers them. */
export async function listContractClauses(): Promise<ContractClauseDTO[]> {
  const session = await getAdminSession();
  if (!session) return [];

  const rows = await db.orm.public.ContractClause.select(
    "id",
    "title",
    "body",
    "active",
    "sortOrder",
    "updatedAt",
  )
    .orderBy((f) => f.sortOrder.asc())
    .all();

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    active: row.active,
    sortOrder: row.sortOrder,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}

/** Create or update one article. */
export async function upsertContractClause(input: {
  id?: string | null;
  title: string;
  body: string;
  active: boolean;
}): Promise<ContractClauseResult> {
  const session = await getAdminSession();
  if (!session) return fail("Sesi admin tidak valid.");

  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return fail("Judul pasal wajib diisi.", "title");
  if (!body) return fail("Isi pasal wajib diisi.", "body");

  if (input.id) {
    const existing = await db.orm.public.ContractClause.select("id")
      .where((f) => f.id.eq(input.id!))
      .first();
    if (!existing) return fail("Pasal tidak ditemukan.");

    await db.orm.public.ContractClause.where((f) => f.id.eq(input.id!)).update({
      title,
      body,
      active: input.active,
    });
    return { ok: true, message: "Pasal tersimpan." };
  }

  const last = await db.orm.public.ContractClause.select("sortOrder")
    .orderBy((f) => f.sortOrder.desc())
    .first();

  await db.orm.public.ContractClause.create({
    id: crypto.randomUUID(),
    title,
    body,
    active: input.active,
    sortOrder: (last?.sortOrder ?? 0) + 1,
  });
  return { ok: true, message: "Pasal dibuat." };
}

/** Delete one article and close the ordering gap. */
export async function deleteContractClause(id: string): Promise<ContractClauseResult> {
  const session = await getAdminSession();
  if (!session) return fail("Sesi admin tidak valid.");

  const row = await db.orm.public.ContractClause.select("id", "sortOrder")
    .where((f) => f.id.eq(id))
    .first();
  if (!row) return fail("Pasal tidak ditemukan.");

  await db.orm.public.ContractClause.where((f) => f.id.eq(id)).deleteAll();

  // Renumber the remaining articles so the agreement numbering stays dense.
  const rest = await db.orm.public.ContractClause.select("id")
    .orderBy((f) => f.sortOrder.asc())
    .all();
  for (const [index, row] of rest.entries()) {
    await db.orm.public.ContractClause.where((f) => f.id.eq(row.id)).update({
      sortOrder: index + 1,
    });
  }

  return { ok: true, message: "Pasal dihapus." };
}

/** Move one article up or down in the agreement numbering. */
export async function moveContractClause(
  id: string,
  direction: "up" | "down",
): Promise<ContractClauseResult> {
  const session = await getAdminSession();
  if (!session) return fail("Sesi admin tidak valid.");

  const rows = await db.orm.public.ContractClause.select("id", "sortOrder")
    .orderBy((f) => f.sortOrder.asc())
    .all();

  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return fail("Pasal tidak ditemukan.");

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rows.length) {
    return fail("Urutan sudah di ujung.");
  }

  const a = rows[index]!;
  const b = rows[swapWith]!;

  await db.orm.public.ContractClause.where((f) => f.id.eq(a.id)).update({
    sortOrder: b.sortOrder,
  });
  await db.orm.public.ContractClause.where((f) => f.id.eq(b.id)).update({
    sortOrder: a.sortOrder,
  });

  return { ok: true, message: "Urutan diperbarui." };
}

/** Toggle the active flag of one article. */
export async function setContractClauseActive(
  id: string,
  active: boolean,
): Promise<ContractClauseResult> {
  const session = await getAdminSession();
  if (!session) return fail("Sesi admin tidak valid.");

  const row = await db.orm.public.ContractClause.select("id")
    .where((f) => f.id.eq(id))
    .first();
  if (!row) return fail("Pasal tidak ditemukan.");

  await db.orm.public.ContractClause.where((f) => f.id.eq(id)).update({ active });
  return { ok: true, message: active ? "Pasal aktif." : "Pasal nonaktif." };
}

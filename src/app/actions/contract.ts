"use server";

import { db } from "@/prisma/db";

/**
 * The customer-facing actions of the transport rental agreement.
 *
 * The wizard's agreement step reads the active articles; the signed copy of
 * a booking is readable by whoever proves ownership with the contact email
 * — the same rule the payment and invoice flows use.
 */

export type ContractClauseDTO = {
  id: string;
  title: string;
  body: string;
  sortOrder: number;
};

/** The active articles, numbered by `sortOrder` — the agreement step. */
export async function getActiveContractClauses(): Promise<ContractClauseDTO[]> {
  const rows = await db.orm.public.ContractClause.select(
    "id",
    "title",
    "body",
    "sortOrder",
  )
    .where((f) => f.active.eq(true))
    .orderBy((f) => f.sortOrder.asc())
    .all();

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    sortOrder: row.sortOrder,
  }));
}

export type SignedContractDTO = {
  bookingCode: string;
  signerName: string;
  signatureUrl: string;
  signedAt: string;
  clauses: ContractClauseDTO[];
};

/**
 * The signed agreement of a booking — ownership is proven with the contact
 * email, the same rule the invoice page uses.
 */
export async function getSignedContractByCode(params: {
  bookingCode: string;
  email: string;
}): Promise<SignedContractDTO | null> {
  const code = params.bookingCode.trim().toUpperCase();
  const email = params.email.trim().toLowerCase();
  if (!code || !email) return null;

  const bookings = await db.orm.public.Booking.select("id", "code")
    .where((f) => f.code.eq(code))
    .limit(1)
    .all();
  const booking = bookings[0];
  if (!booking) return null;

  const contacts = await db.orm.public.Contact.select("email")
    .where((f) => f.bookingId.eq(booking.id))
    .limit(1)
    .all();
  if (!contacts[0] || contacts[0].email.trim().toLowerCase() !== email) {
    return null;
  }

  const contracts = await db.orm.public.SignedContract.select(
    "signerName",
    "signatureUrl",
    "signedAt",
    "clausesSnapshot",
  )
    .where((f) => f.bookingId.eq(booking.id))
    .limit(1)
    .all();
  const contract = contracts[0];
  if (!contract) return null;

  const snapshot = Array.isArray(contract.clausesSnapshot)
    ? (contract.clausesSnapshot as unknown[])
    : [];

  const clauses: ContractClauseDTO[] = snapshot
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        id: typeof row.id === "string" ? row.id : "",
        title: typeof row.title === "string" ? row.title : "",
        body: typeof row.body === "string" ? row.body : "",
        sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : 0,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    bookingCode: booking.code,
    signerName: contract.signerName,
    signatureUrl: contract.signatureUrl,
    signedAt: new Date(contract.signedAt).toISOString(),
    clauses,
  };
}

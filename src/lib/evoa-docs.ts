import "server-only";

// Server-side persistence helpers for e-VOA documents (VisaDocument rows).
// The upload route stores the bytes in R2; these helpers attach the returned
// file references to an order, list them back as DTOs, and remove them.

import { db } from "@/prisma/db";
import { deleteObject } from "@/lib/storage";
import type { EvoaFileRef, EvoaDocumentDTO } from "@/lib/evoa-shared";

/**
 * Persist one VisaDocument row per uploaded file reference, in the given
 * order (sortOrder = index). All rows land in one transaction so a failure
 * never leaves a half-attached document set. New documents start "pending"
 * review.
 */
export async function createDocumentRows(
  applicationId: string,
  applicantId: string | null,
  slot: string,
  refs: EvoaFileRef[],
): Promise<void> {
  if (refs.length === 0) return;
  await db.transaction(async (tx) => {
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!;
      await tx.orm.public.VisaDocument.create({
        id: crypto.randomUUID(),
        applicationId,
        applicantId,
        slot,
        key: ref.key,
        url: ref.url,
        fileName: ref.fileName,
        mimeType: ref.mimeType,
        sizeBytes: ref.sizeBytes,
        sortOrder: i,
        reviewStatus: "pending",
      });
    }
  });
}

/** All documents of one order (every applicant + order-level), ordered by
 * slot then sortOrder — the display order of the wizard and admin panel. */
export async function listOrderDocuments(
  applicationId: string,
): Promise<EvoaDocumentDTO[]> {
  const rows = await db.orm.public.VisaDocument
    .select(
      "id",
      "applicantId",
      "slot",
      "key",
      "url",
      "fileName",
      "mimeType",
      "sizeBytes",
      "sortOrder",
      "reviewStatus",
      "reviewNote",
    )
    .where((f) => f.applicationId.eq(applicationId))
    .orderBy([(f) => f.slot.asc(), (f) => f.sortOrder.asc()])
    .all();
  return rows;
}

/** Delete one document row, then best-effort remove the R2 object. The row
 * goes first: a failed object delete only orphans the bytes (logged), while
 * the database — the source of truth for what the order shows — stays clean. */
export async function deleteDocumentRow(id: string): Promise<void> {
  const rows = await db.orm.public.VisaDocument
    .select("id", "key")
    .where((f) => f.id.eq(id))
    .limit(1)
    .all();
  const doc = rows[0];
  if (!doc) return;

  await db.orm.public.VisaDocument.where((f) => f.id.eq(id)).delete();

  try {
    await deleteObject(doc.key);
  } catch (error) {
    console.error("[evoa-docs] could not delete R2 object", doc.key, error);
  }
}

/** Ownership guard: the order only when it belongs to `uid`. Guest orders
 * (userId null) never match — SQL equality excludes NULL. */
export async function getOrderForUser(
  applicationId: string,
  uid: string,
): Promise<{
  id: string;
  code: string;
  userId: string | null;
  status: string;
  bookingId: string | null;
} | null> {
  const rows = await db.orm.public.VisaApplication
    .select("id", "code", "userId", "status", "bookingId")
    .where((f) => f.id.eq(applicationId))
    .where((f) => f.userId.eq(uid))
    .limit(1)
    .all();
  return rows[0] ?? null;
}
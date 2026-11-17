import "server-only";

import { db } from "@/prisma/db";
import {
  EVOA_FIELD_SCOPES,
  EVOA_FIELD_TYPES,
  validateEvoaAnswers,
  type EvoaAnswers,
  type EvoaFieldDefDTO,
  type EvoaFieldOption,
  type EvoaFieldScope,
  type EvoaFieldType,
  type EvoaShowWhen,
} from "@/lib/evoa-shared";

/**
 * Server-side access to the admin-defined dynamic form fields
 * (`EvoaFormField`). The wizard and the submit action both read through
 * here so the Json columns are parsed exactly once, defensively — a bad
 * row must never crash the public form.
 */

/** The scalar columns of an EvoaFormField row. Json columns arrive as
 * `unknown` on purpose: `rowToFieldDef` is the only place that trusts them. */
export type EvoaFormFieldRow = {
  id: string;
  key: string;
  labelEn: string;
  labelId: string | null;
  type: string;
  scope: string;
  required: boolean;
  options: unknown;
  showWhen: unknown;
  placeholderEn: string | null;
  placeholderId: string | null;
  helpEn: string | null;
  helpId: string | null;
  maxFiles: number | null;
  sortOrder: number;
  active: boolean;
};

/** Every scalar column — kept in one place so reads stay consistent. */
const FIELD_COLUMNS = [
  "id",
  "key",
  "labelEn",
  "labelId",
  "type",
  "scope",
  "required",
  "options",
  "showWhen",
  "placeholderEn",
  "placeholderId",
  "helpEn",
  "helpId",
  "maxFiles",
  "sortOrder",
  "active",
] as const;

/** Parse the `options` Json into select options. Anything that is not an
 * array of `{ value, labelEn, labelId? }` with non-empty strings is dropped;
 * a wholly invalid column yields `[]` (the field then renders no options
 * instead of throwing). */
function parseOptions(raw: unknown): EvoaFieldOption[] {
  if (!Array.isArray(raw)) return [];
  const options: EvoaFieldOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.value !== "string" || o.value.trim() === "") continue;
    if (typeof o.labelEn !== "string" || o.labelEn.trim() === "") continue;
    options.push({
      value: o.value,
      labelEn: o.labelEn,
      labelId: typeof o.labelId === "string" ? o.labelId : undefined,
    });
  }
  return options;
}

/** Parse the `showWhen` Json. Only `{ field: <non-empty string>, equals:
 * <string> }` is a valid rule; everything else means "always visible". */
function parseShowWhen(raw: unknown): EvoaShowWhen | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== "string" || r.field.trim() === "") return null;
  if (typeof r.equals !== "string") return null;
  return { field: r.field, equals: r.equals };
}

/** Map a database row to the client-facing definition. Invalid Json falls
 * back to safe defaults; an unknown type/scope degrades to text/applicant
 * rather than breaking the whole form. */
export function rowToFieldDef(row: EvoaFormFieldRow): EvoaFieldDefDTO {
  const type = (EVOA_FIELD_TYPES as readonly string[]).includes(row.type)
    ? (row.type as EvoaFieldType)
    : "text";
  const scope = (EVOA_FIELD_SCOPES as readonly string[]).includes(row.scope)
    ? (row.scope as EvoaFieldScope)
    : "applicant";

  return {
    id: row.id,
    key: row.key,
    labelEn: row.labelEn,
    labelId: row.labelId,
    type,
    scope,
    required: row.required,
    options: parseOptions(row.options),
    showWhen: parseShowWhen(row.showWhen),
    placeholderEn: row.placeholderEn,
    placeholderId: row.placeholderId,
    helpEn: row.helpEn,
    helpId: row.helpId,
    maxFiles: row.maxFiles,
    sortOrder: row.sortOrder,
  };
}

/** Active field definitions, ordered for display. Optionally restricted to
 * one scope ("application" = once per order, "applicant" = per person). */
export async function listEvoaFieldDefs(
  scope?: EvoaFieldScope,
): Promise<EvoaFieldDefDTO[]> {
  let query = db.orm.public.EvoaFormField.select(...FIELD_COLUMNS).where(
    (f) => f.active.eq(true),
  );
  if (scope) query = query.where((f) => f.scope.eq(scope));
  const rows = await query.orderBy((f) => f.sortOrder.asc()).all();
  return rows.map(rowToFieldDef);
}

/** Validate an answers map against the visible fields of one scope.
 * Delegates to the shared pure validator so client and server agree. */
export async function validateScopeAnswers(
  scope: EvoaFieldScope,
  answers: EvoaAnswers,
  ctx: { purpose?: string },
): Promise<{ ok: true } | { ok: false; fieldKey: string; error: string }> {
  const defs = await listEvoaFieldDefs(scope);
  return validateEvoaAnswers(defs, answers, { purpose: ctx.purpose, answers });
}
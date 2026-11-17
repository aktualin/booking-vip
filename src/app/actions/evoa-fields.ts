"use server";

import { db } from "@/prisma/db";
import { getAdminSession } from "@/lib/admin/session";
import { rowToFieldDef, type EvoaFormFieldRow } from "@/lib/evoa-fields";
import {
  EVOA_FIELD_SCOPES,
  EVOA_FIELD_TYPES,
  type EvoaFieldDefDTO,
  type EvoaFieldOption,
  type EvoaFieldScope,
  type EvoaFieldType,
  type EvoaShowWhen,
} from "@/lib/evoa-shared";

/**
 * Admin actions for the dynamic e-VOA form fields.
 *
 * Every action verifies the admin session first — Server Functions are
 * reachable by direct POST, not only through the admin UI. Validation is
 * duplicated here (not only in the builder) for the same reason.
 */

/** A field definition plus its active flag — the admin table needs both. */
export type EvoaFieldAdminDTO = EvoaFieldDefDTO & { active: boolean };

/** What the builder sends when creating or editing a field. */
export type EvoaFieldInput = {
  key: string;
  labelEn: string;
  labelId?: string | null;
  type: EvoaFieldType;
  scope: EvoaFieldScope;
  required?: boolean;
  options?: EvoaFieldOption[];
  showWhen?: EvoaShowWhen | null;
  placeholderEn?: string | null;
  placeholderId?: string | null;
  helpEn?: string | null;
  helpId?: string | null;
  maxFiles?: number | null;
  sortOrder?: number;
  active?: boolean;
};

export type EvoaFieldActionResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string; field?: string };

export type EvoaFieldListResult =
  | { ok: true; data: EvoaFieldAdminDTO[] }
  | { ok: false; error: string };

const KEY_RE = /^[a-z][a-z0-9_]{2,40}$/;

/** Keys owned by the standard form / document slots — a dynamic field may
 * never shadow them, or answers and uploads would collide. */
const RESERVED_KEYS = ["passport", "photo", "ticket", "hotel", "purpose", "visa-pdf"];

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

/** Trim an optional text column; empty becomes null so the DB stays clean. */
function optionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

type ValidatedField = {
  key: string;
  labelEn: string;
  labelId: string | null;
  type: EvoaFieldType;
  scope: EvoaFieldScope;
  required: boolean;
  options: EvoaFieldOption[];
  showWhen: EvoaShowWhen | null;
  placeholderEn: string | null;
  placeholderId: string | null;
  helpEn: string | null;
  helpId: string | null;
  maxFiles: number | null;
  sortOrder: number;
  active: boolean;
};

/** Validate the builder input. `excludeId` lets an edit keep its own key.
 * Returns the normalized row payload or a field-tagged error. */
async function validateFieldInput(
  input: EvoaFieldInput,
  excludeId?: string,
): Promise<{ ok: true; data: ValidatedField } | { ok: false; error: string; field?: string }> {
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (RESERVED_KEYS.includes(key)) {
    return { ok: false, error: `Key "${key}" sudah dipakai formulir standar dan tidak boleh digunakan.`, field: "key" };
  }
  if (!KEY_RE.test(key)) {
    return {
      ok: false,
      error: "Key harus diawali huruf kecil, lalu huruf kecil/angka/underscore (3–41 karakter).",
      field: "key",
    };
  }

  const keyOwner = await db.orm.public.EvoaFormField.select("id").where({ key }).first();
  if (keyOwner && keyOwner.id !== excludeId) {
    return { ok: false, error: `Key "${key}" sudah digunakan field lain.`, field: "key" };
  }

  const labelEn = typeof input.labelEn === "string" ? input.labelEn.trim() : "";
  if (!labelEn) {
    return { ok: false, error: "Label (EN) wajib diisi.", field: "labelEn" };
  }

  if (!(EVOA_FIELD_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, error: "Jenis field tidak valid.", field: "type" };
  }
  if (!(EVOA_FIELD_SCOPES as readonly string[]).includes(input.scope)) {
    return { ok: false, error: "Cakupan field tidak valid.", field: "scope" };
  }
  const type = input.type as EvoaFieldType;
  const scope = input.scope as EvoaFieldScope;

  // Select fields need at least one usable option; values must stay unique
  // so an answer always maps back to exactly one option.
  let options: EvoaFieldOption[] = [];
  if (type === "select") {
    const raw = Array.isArray(input.options) ? input.options : [];
    const seen = new Set<string>();
    for (const opt of raw) {
      const value = typeof opt?.value === "string" ? opt.value.trim() : "";
      const optLabelEn = typeof opt?.labelEn === "string" ? opt.labelEn.trim() : "";
      if (!value || !optLabelEn) {
        return { ok: false, error: "Setiap opsi butuh value dan label (EN).", field: "options" };
      }
      if (seen.has(value)) {
        return { ok: false, error: `Value opsi "${value}" duplikat.`, field: "options" };
      }
      seen.add(value);
      options.push({
        value,
        labelEn: optLabelEn,
        labelId: optionalText(opt.labelId) ?? undefined,
      });
    }
    if (options.length === 0) {
      return { ok: false, error: "Field pilihan (select) butuh minimal satu opsi.", field: "options" };
    }
  }

  // Optional visibility rule: a non-empty field name plus a string to match.
  let showWhen: EvoaShowWhen | null = null;
  if (input.showWhen != null) {
    const rule = input.showWhen;
    if (typeof rule.field !== "string" || rule.field.trim() === "") {
      return { ok: false, error: "Nama field pada aturan tampil (showWhen) wajib diisi.", field: "showWhen" };
    }
    if (typeof rule.equals !== "string") {
      return { ok: false, error: "Nilai pembanding aturan tampil (showWhen) tidak valid.", field: "showWhen" };
    }
    showWhen = { field: rule.field.trim(), equals: rule.equals };
  }

  // File fields cap the upload count (1..10); other types store null.
  let maxFiles: number | null = null;
  if (type === "file") {
    const raw = input.maxFiles ?? 1;
    if (!Number.isInteger(raw) || raw < 1 || raw > 10) {
      return { ok: false, error: "Jumlah file maksimal harus antara 1 dan 10.", field: "maxFiles" };
    }
    maxFiles = raw;
  }

  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false, error: "Urutan harus berupa angka bulat ≥ 0.", field: "sortOrder" };
  }

  return {
    ok: true,
    data: {
      key,
      labelEn,
      labelId: optionalText(input.labelId),
      type,
      scope,
      required: input.required === true,
      options,
      showWhen,
      placeholderEn: optionalText(input.placeholderEn),
      placeholderId: optionalText(input.placeholderId),
      helpEn: optionalText(input.helpEn),
      helpId: optionalText(input.helpId),
      maxFiles,
      sortOrder,
      active: input.active !== false,
    },
  };
}

/** All fields (including inactive ones), ordered — the admin table view. */
export async function listEvoaFieldsAdmin(): Promise<EvoaFieldListResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Sesi admin tidak valid." };

  const rows = await db.orm.public.EvoaFormField.select(...FIELD_COLUMNS)
    .orderBy((f) => f.sortOrder.asc())
    .all();

  const data: EvoaFieldAdminDTO[] = rows.map((row: EvoaFormFieldRow) => ({
    ...rowToFieldDef(row),
    active: row.active,
  }));
  return { ok: true, data };
}

/** Create a new dynamic field. */
export async function createEvoaField(input: EvoaFieldInput): Promise<EvoaFieldActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Sesi admin tidak valid." };

  const validated = await validateFieldInput(input);
  if (!validated.ok) return validated;

  const id = crypto.randomUUID();
  try {
    await db.orm.public.EvoaFormField.create({
      id,
      ...validated.data,
      options: validated.data.options as never,
      showWhen: validated.data.showWhen as never,
    });
  } catch {
    return { ok: false, error: "Gagal menyimpan field. Coba lagi." };
  }
  return { ok: true, data: { id } };
}

/** Update an existing field. The key is validated for uniqueness but the
 * builder keeps it locked — renaming would orphan stored answers. */
export async function updateEvoaField(
  id: string,
  input: EvoaFieldInput,
): Promise<EvoaFieldActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Sesi admin tidak valid." };

  const existing = await db.orm.public.EvoaFormField.select("id").where({ id }).first();
  if (!existing) return { ok: false, error: "Field tidak ditemukan." };

  const validated = await validateFieldInput(input, id);
  if (!validated.ok) return validated;

  try {
    await db.orm.public.EvoaFormField.where({ id }).update({
      ...validated.data,
      options: validated.data.options as never,
      showWhen: validated.data.showWhen as never,
    });
  } catch {
    return { ok: false, error: "Gagal menyimpan field. Coba lagi." };
  }
  return { ok: true, data: { id } };
}

/** Delete a field. Answers already stored in order/applicant Json keep the
 * old key — harmless, they are simply no longer rendered or validated. */
export async function deleteEvoaField(id: string): Promise<EvoaFieldActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Sesi admin tidak valid." };

  const existing = await db.orm.public.EvoaFormField.select("id").where({ id }).first();
  if (!existing) return { ok: false, error: "Field tidak ditemukan." };

  await db.orm.public.EvoaFormField.where({ id }).delete();
  return { ok: true, data: { id } };
}

/** Convenience toggle used by the table's active switch. */
export async function setEvoaFieldActive(
  id: string,
  active: boolean,
): Promise<EvoaFieldActionResult> {
  const session = await getAdminSession();
  if (!session) return { ok: false, error: "Sesi admin tidak valid." };

  if (typeof active !== "boolean") {
    return { ok: false, error: "Status aktif tidak valid.", field: "active" };
  }

  const existing = await db.orm.public.EvoaFormField.select("id").where({ id }).first();
  if (!existing) return { ok: false, error: "Field tidak ditemukan." };

  await db.orm.public.EvoaFormField.where({ id }).update({ active });
  return { ok: true, data: { id } };
}
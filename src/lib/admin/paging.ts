/**
 * Server-side pagination helpers for the admin list actions.
 *
 * Two flavours, because the admin lists are not all plain table scans:
 *
 *  - **DB paging** — `resolvePaging` validates the incoming params and
 *    `fieldOrder` / `ilikeAny` build the Prisma ORM `orderBy` / `where`
 *    fragments. Sorting is only ever allowed on an explicit allowlist of
 *    direct model fields, so a client can never inject an arbitrary column.
 *  - **In-memory paging** — `paginateList` for the lists that are assembled
 *    in JS anyway (discount campaigns, tour departures). It runs the same
 *    param validation, a case-insensitive search over a per-row haystack and
 *    a comparator built from the same allowlist idea.
 */

import { or } from "@prisma/orm-postgres/orm-client";
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_MAX_PAGE_SIZE,
  type AdminListParams,
  type AdminPaged,
  type AdminSortDir,
} from "@/types/admin-pagination";

export type ResolvedPaging = {
  page: number;
  pageSize: number;
  offset: number;
  /** Trimmed search text, or null when empty. */
  search: string | null;
  /** Validated sort field, or null when absent / not allowed. */
  sortBy: string | null;
  sortDir: AdminSortDir;
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Validate and normalize the incoming list params.
 *
 * Out-of-range values are clamped rather than rejected so a stale bookmark
 * or a hand-edited request still renders something sane.
 */
export function resolvePaging(
  params: AdminListParams | undefined,
  allowedSortKeys?: readonly string[],
): ResolvedPaging {
  const page = isPositiveInt(params?.page) && params!.page! >= 1 ? params!.page! : 1;
  const requestedSize = isPositiveInt(params?.pageSize) ? params!.pageSize! : ADMIN_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(requestedSize, 1), ADMIN_MAX_PAGE_SIZE);

  const search = params?.search?.trim() ? params.search.trim() : null;

  const sortBy =
    params?.sortBy && (!allowedSortKeys || allowedSortKeys.includes(params.sortBy))
      ? params.sortBy
      : null;
  const sortDir: AdminSortDir = params?.sortDir === "desc" ? "desc" : "asc";

  return { page, pageSize, offset: (page - 1) * pageSize, search, sortBy, sortDir };
}

/** Escape the LIKE wildcards so a search for "100%" does not match everything. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * An `orderBy` callback over a single direct model field.
 *
 * The ORM's field accessor is strongly typed per model, but the sort key is
 * only known at runtime (after the allowlist check in `resolvePaging`), so the
 * dynamic lookup goes through `any` here — the allowlist is the real guard.
 */
export function fieldOrder(
  field: string,
  dir: AdminSortDir,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (f: any) => any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (f: any) => (dir === "asc" ? f[field].asc() : f[field].desc());
}

/**
 * A `where` predicate matching the search text (case-insensitively) against
 * any of the given direct model text fields.
 */
export function ilikeAny(
  fields: readonly string[],
  search: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (f: any) => any {
  const like = `%${escapeLike(search)}%`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (f: any) => or(...fields.map((name) => f[name].ilike(like)));
}

// ---------------------------------------------------------------------------
// In-memory paging
// ---------------------------------------------------------------------------

export type PaginateListOptions<T> = {
  /** The concatenated, lowercased haystack used for the global search. */
  searchOf: (row: T) => string;
  /** Sort keys this list accepts; anything else falls back to `defaultCompare`. */
  allowedSortKeys?: readonly string[];
  /** The value of one sortable key for one row. */
  sortValueOf?: (row: T, key: string) => string | number | boolean | null | undefined;
  /** Order used when no (valid) sortBy is given. */
  defaultCompare?: (a: T, b: T) => number;
};

/**
 * Filter → sort → slice a fully-materialized list.
 *
 * Used by the admin lists that are assembled in memory (campaigns,
 * departures). Behaves exactly like the DB-paged actions from the client's
 * point of view: same params, same envelope.
 */
export function paginateList<T>(
  allRows: T[],
  params: AdminListParams | undefined,
  opts: PaginateListOptions<T>,
): AdminPaged<T> {
  const resolved = resolvePaging(params, opts.allowedSortKeys);

  let rows = allRows;

  if (resolved.search) {
    const needle = resolved.search.toLowerCase();
    rows = rows.filter((row) => opts.searchOf(row).toLowerCase().includes(needle));
  }

  if (resolved.sortBy && opts.sortValueOf) {
    const key = resolved.sortBy;
    const dir = resolved.sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const va = opts.sortValueOf!(a, key);
      const vb = opts.sortValueOf!(b, key);
      return compareValues(va, vb) * dir;
    });
  } else if (opts.defaultCompare) {
    rows = [...rows].sort(opts.defaultCompare);
  }

  const pageRows = rows.slice(resolved.offset, resolved.offset + resolved.pageSize);

  return { rows: pageRows, total: rows.length, page: resolved.page, pageSize: resolved.pageSize };
}

/** Null-safe total ordering for the in-memory comparator. */
function compareValues(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
): number {
  // Nulls always sort last, regardless of direction sanity needs.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

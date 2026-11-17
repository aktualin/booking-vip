/**
 * Shared pagination / search / sorting vocabulary for the admin tables.
 *
 * Every paged admin list action accepts `AdminListParams` and answers with
 * `AdminPaged<T>`. The client hook (`useAdminPagedList`) owns the same shape,
 * so the contract between the table UI and the server actions is one type.
 */

export type AdminSortDir = "asc" | "desc";

export type AdminListParams = {
  /** 1-based page number. Defaults to 1. */
  page?: number;
  /** Rows per page. Defaults to 5, clamped to 1..100. */
  pageSize?: number;
  /** Global case-insensitive search over the entity's text fields. */
  search?: string;
  /** Column key to sort by — must be in the entity's allowlist. */
  sortBy?: string;
  /** Sort direction. Defaults to "asc". */
  sortDir?: AdminSortDir;
};

export type AdminPaged<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** The default page size of every admin table. */
export const ADMIN_DEFAULT_PAGE_SIZE = 5;

/** Hard cap so a hostile pageSize can never pull the whole table. */
export const ADMIN_MAX_PAGE_SIZE = 100;

/** The page-size options offered by the table footer selector. */
export const ADMIN_PAGE_SIZES = [5, 10, 20, 50] as const;

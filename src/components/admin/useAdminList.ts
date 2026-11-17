"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AdminListParams,
  AdminPaged,
  AdminSortDir,
} from "@/types/admin-pagination";
import { ADMIN_DEFAULT_PAGE_SIZE } from "@/types/admin-pagination";
import type { TableSort } from "./DataTable";

/**
 * Minimal data-fetching helper for the admin tables.
 *
 * The admin pages follow the same pattern as the public site: the page shell
 * stays static and the client component pulls the rows through a server
 * action. That keeps the database out of the render path.
 */
export function useAdminList<T>(
  load: () => Promise<T[]>,
): {
  rows: T[];
  loading: boolean;
  error: string;
  reload: () => void;
} {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    load()
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { rows, loading, error, reload };
}

/**
 * The paged counterpart of `useAdminList`.
 *
 * Owns the full table state — page, page size, debounced search and column
 * sort — and re-runs the server action whenever any of it changes. Changing
 * the search, the sort or the page size always jumps back to page 1; deleting
 * the last row of the last page rewinds one page automatically.
 */
export function useAdminPagedList<T>(
  load: (params: AdminListParams) => Promise<AdminPaged<T>>,
  options?: { pageSize?: number; debounceMs?: number },
): {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  /** The raw input value — bound to the search box. */
  searchInput: string;
  /** The debounced, applied search text. */
  search: string;
  sort: TableSort | null;
  loading: boolean;
  error: string;
  reload: () => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSearchInput: (value: string) => void;
  /** Click a sortable header: none → asc → desc → asc … */
  toggleSort: (key: string) => void;
} {
  const initialPageSize = options?.pageSize ?? ADMIN_DEFAULT_PAGE_SIZE;
  const debounceMs = options?.debounceMs ?? 300;

  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TableSort | null>(null);
  const [data, setData] = useState<AdminPaged<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  // Debounce the search box; applying a new search resets to page 1.
  const firstDebounce = useRef(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (firstDebounce.current) {
        firstDebounce.current = false;
      } else {
        setPageState(1);
      }
      setSearch(next);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [searchInput, debounceMs]);

  const params = useMemo<AdminListParams>(
    () => ({
      page,
      pageSize,
      search: search || undefined,
      sortBy: sort?.key,
      sortDir: sort?.dir as AdminSortDir | undefined,
    }),
    [page, pageSize, search, sort],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    load(params)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load, params, nonce]);

  // The last row of the last page was deleted — rewind so the table is never
  // stranded on an empty page while rows still exist.
  useEffect(() => {
    if (data && data.total > 0 && data.rows.length === 0 && page > 1) {
      setPageState(Math.max(1, Math.ceil(data.total / pageSize)));
    }
  }, [data, page, pageSize]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const setPage = useCallback((next: number) => {
    setPageState(Math.max(1, Math.floor(next) || 1));
  }, []);

  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next);
    setPageState(1);
  }, []);

  const toggleSort = useCallback((key: string) => {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
    setPageState(1);
  }, []);

  return {
    rows: data?.rows ?? [],
    total: data?.total ?? 0,
    page,
    pageSize,
    searchInput,
    search,
    sort,
    loading,
    error,
    reload,
    setPage,
    setPageSize,
    setSearchInput,
    toggleSort,
  };
}

/**
 * The same helper for a single value (dashboard stats, reference data).
 */
export function useAdminValue<T>(
  load: () => Promise<T>,
): {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    load()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

/**
 * Load a single row of a catalog list.
 *
 * The admin pages never read the database during render — the list actions
 * return the whole table and the row is picked from it. `id` is undefined in
 * create mode, in which case nothing is loaded.
 */
export function useAdminRow<T>(
  id: string | undefined,
  load: () => Promise<T[]>,
  getKey: (row: T) => string,
): {
  row: T | null;
  loading: boolean;
  error: string;
  /** True when the row was requested but does not exist (anymore). */
  missing: boolean;
} {
  const [row, setRow] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(id));
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!id) {
      setRow(null);
      setLoading(false);
      setMissing(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    setMissing(false);

    load()
      .then((rows) => {
        if (cancelled) return;
        const found = rows.find((item) => getKey(item) === id);
        setRow(found ?? null);
        setMissing(!found);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, load, getKey]);

  return { row, loading, error, missing };
}

/** Run an async admin action and report failures as a message string. */
export async function runAdminAction(
  action: () => Promise<unknown>,
): Promise<string> {
  try {
    await action();
    return "";
  } catch (err: unknown) {
    return err instanceof Error ? err.message : "Terjadi kesalahan";
  }
}

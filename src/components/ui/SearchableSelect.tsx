"use client";

import { useMemo, useState } from "react";
import Popover from "@/components/ui/Popover";
import { ChevronDown, SearchIcon } from "@/components/icons";

export type SearchableSelectOption = {
  /** Value stored on selection. */
  value: string;
  /** Primary label shown in the list and on the trigger. */
  label: string;
  /** Secondary text (e.g. a country code) — also matched by the search. */
  hint?: string;
};

/**
 * A select with a built-in search box — a trigger that opens a popover with
 * a filter input above a scrollable option list. Matching runs over both the
 * label and the hint, case-insensitively.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  label,
  placeholder,
  searchPlaceholder,
  emptyText,
  ariaLabel,
}: {
  options: SearchableSelectOption[];
  /** The currently selected value ("" when nothing is picked yet). */
  value: string;
  onChange: (value: string) => void;
  /** Optional field label rendered above the trigger. */
  label?: string;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown when the search query matches nothing. */
  emptyText?: string;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  return (
    <div>
      {label ? (
        <span className="mb-1.5 block text-[12px] font-medium text-ink">
          {label}
        </span>
      ) : null}
      <Popover
        ariaLabel={ariaLabel ?? label}
        panelClassName="w-[min(22rem,calc(100vw-2rem))] sm:w-[24rem]"
        onOpenChange={(open) => {
          // A fresh search every time the panel opens.
          if (open) setQuery("");
        }}
        trigger={
          <span
            className={`flex h-11 items-center gap-2 rounded-xl border bg-white px-3 text-[13px] transition-colors hover:bg-canvas ${
              selected ? "border-line text-ink" : "border-line text-muted"
            }`}
          >
            <span className="min-w-0 flex-1 truncate">
              {selected ? selected.label : placeholder}
            </span>
            {selected?.hint ? (
              <span className="shrink-0 font-mono text-[11px] text-muted">
                {selected.hint}
              </span>
            ) : null}
            <ChevronDown
              width={16}
              height={16}
              className="shrink-0 text-muted"
            />
          </span>
        }
      >
        {({ close }) => (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative mb-2 shrink-0">
              <SearchIcon
                width={16}
                height={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                ref={(el) => {
                  // Focus without letting the browser scroll the page to the
                  // panel before its first placement.
                  el?.focus({ preventScroll: true });
                }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-xl border border-line bg-canvas py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-brand"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted">
                {emptyText}
              </p>
            ) : (
              <ul className="-mr-1 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {filtered.map((o) => {
                  const active = o.value === value;
                  return (
                    <li key={o.value}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(o.value);
                          close();
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? "border-brand bg-brand-soft"
                            : "border-transparent hover:bg-canvas"
                        }`}
                      >
                        <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                          {o.label}
                        </span>
                        {o.hint ? (
                          <span className="shrink-0 font-mono text-[11px] text-muted">
                            {o.hint}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}

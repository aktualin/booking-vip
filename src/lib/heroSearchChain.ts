// Pure helpers for the hero search's sequential field chain (progressive
// disclosure).
//
// The chain is the ordered list of rendered fields — position-based, so the
// database `sortOrder` behind `useSearchFields` decides the sequence and an
// admin re-sort automatically re-sequences the gating. No React, no values
// store — just the field list and one service's flat value map.

import type { ServiceSearchFieldKind } from "@/types";

/** One step of the chain — just enough of a field to gate or reset it. */
export type ChainField = { key: string; kind: ServiceSearchFieldKind };

/** The value map of one service — the same flat query-string keys as the form. */
export type ChainValues = Record<string, string>;

/** The draft keys that hold the passenger counts of a `pax` field. */
export function paxKeys(key: string) {
  return {
    adults: `${key}Adults`,
    children: `${key}Children`,
    infants: `${key}Infants`,
  };
}

/** Every value key a field writes — its own key plus its sibling keys. */
export function fieldValueKeys(field: ChainField): string[] {
  if (field.kind === "datetime") return [field.key, `${field.key}Time`];
  if (field.kind === "pax")
    return [field.key, ...Object.values(paxKeys(field.key))];
  return [field.key];
}

/**
 * Whether a chain step counts as filled. `pax` always is — its tile renders a
 * concrete default (DEFAULT_PAX), so requiring a touch would block submit on
 * a visibly filled field. `datetime` needs the date AND the time, because the
 * tile's own display reads both. Everything else: a non-empty value.
 */
export function isFieldFilled(field: ChainField, values: ChainValues): boolean {
  if (field.kind === "pax") return true;
  const value = values[field.key];
  if (!value || !value.trim()) return false;
  if (field.kind === "datetime") {
    const time = values[`${field.key}Time`];
    return Boolean(time && time.trim());
  }
  return true;
}

/** Index of the first unfilled step, or `-1` when the chain is complete. */
export function firstUnfilledIndex(
  fields: ChainField[],
  values: ChainValues
): number {
  return fields.findIndex((f) => !isFieldFilled(f, values));
}

/**
 * A copy of `values` without every key written by the steps after
 * `changedIndex` — the reset that follows a change to an upstream field.
 */
export function resetDownstream(
  values: ChainValues,
  fields: ChainField[],
  changedIndex: number
): ChainValues {
  const next = { ...values };
  for (const f of fields.slice(changedIndex + 1)) {
    for (const key of fieldValueKeys(f)) delete next[key];
  }
  return next;
}

/** True when every step of the chain is filled — the gate on the search CTA. */
export function chainComplete(
  fields: ChainField[],
  values: ChainValues
): boolean {
  return fields.every((f) => isFieldFilled(f, values));
}

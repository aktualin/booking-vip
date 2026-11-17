"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { formatMoneyWith } from "@/lib/currency";
import { makeTranslator, type DictKey } from "@/i18n";

// ---------------------------------------------------------------------------
// Locale context.
//
// `useLocale()` is the single hook components use to read the user's language
// preference and to format prices (USD-only). The shape is a hard contract —
// do not rename fields.
// ---------------------------------------------------------------------------

export type Lang = "en" | "id";

type LocaleState = {
  lang: Lang;
  setLang: (l: Lang) => void;
  formatMoney: (usd: number) => string;
  /** Translate a dictionary key using the current language. */
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleState | null>(null);

const LANG_KEY = "booking-vip:locale";

function readPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable — ignore.
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Hydrate preferences from localStorage on mount.
  useEffect(() => {
    const l = readPref<Lang>(LANG_KEY, "en");
    setLangState(l === "id" ? "id" : "en");

    // One-time cleanup of stale conversion keys left by older builds.
    try {
      window.localStorage.removeItem("booking-vip:fx");
      window.localStorage.removeItem("booking-vip:currency");
    } catch {
      // Storage unavailable — ignore.
    }
  }, []);

  // Keep <html lang="…"> in sync with the user's choice.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writePref(LANG_KEY, l);
  }, []);

  const formatMoney = useCallback((usd: number) => formatMoneyWith(usd), []);

  // Bound translator for the current language.
  const translate = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) =>
      makeTranslator(lang)(key, vars),
    [lang]
  );

  const value = useMemo<LocaleState>(
    () => ({ lang, setLang, formatMoney, t: translate }),
    [lang, setLang, formatMoney, translate]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/**
 * Read the current locale + helpers.
 *
 * Contract shape: `{ lang, setLang, formatMoney, t }` — do not rename fields.
 */
export function useLocale(): LocaleState {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return ctx;
}
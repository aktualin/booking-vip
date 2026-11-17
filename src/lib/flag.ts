import { COUNTRIES, countryByCode } from "@/data/countries";

/**
 * Turn an ISO 3166-1 alpha-2 code into its flag emoji.
 *
 * Each letter maps to a Unicode regional-indicator symbol (U+1F1E6 is "A"),
 * and a pair of them renders as the country flag on macOS, iOS and Android.
 * Unknown or malformed codes fall back to a white flag.
 */
export function flagEmoji(code: string): string {
  const cc = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  const base = 0x1f1e6;
  return String.fromCodePoint(base + cc.charCodeAt(0) - 65, base + cc.charCodeAt(1) - 65);
}

/** The E.164 dial prefix of a country code, e.g. `dialCodeFor("ID") === "+62"`. */
export function dialCodeFor(code: string): string {
  return countryByCode(code)?.dialCode ?? "+62";
}

/**
 * Normalize a stored `phoneCountryCode` into E.164 dial digits ("62").
 *
 * The column is inconsistent across flows: the booking wizard stores an ISO
 * alpha-2 code ("ID"), while the e-VOA path stores a dial prefix ("+62"). This
 * accepts either and returns just the digits, or "" when nothing is recognized.
 */
export function dialDigits(stored: string): string {
  const raw = (stored ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits) return digits; // already a dial prefix ("+62", "62")
  const entry = countryByCode(raw); // ISO alpha-2 → dial digits
  return entry ? entry.dialCode.replace(/\D/g, "") : "";
}

/**
 * Join a country code and a local number into an E.164 string: `"+628123…"`.
 *
 * A leading trunk "0" on the local part is dropped, matching how the rest of
 * the app normalizes Indonesian numbers.
 */
export function formatInternational(code: string, local: string): string {
  const dial = dialCodeFor(code).replace(/\D/g, "");
  let p = (local ?? "").replace(/\D/g, "");
  if (p.startsWith("0")) p = p.slice(1);
  if (!p) return "";
  return `+${dial}${p}`;
}

/**
 * Reverse of `formatInternational` — split a raw phone string into the country
 * it belongs to plus the local digits, so a single-string phone column can be
 * loaded into a `PhoneInput`.
 *
 * Handles `+62812…`, `62812…`, `0812…` and already-international numbers. When
 * nothing recognizable is found it defaults to Indonesia.
 */
export function parseInternationalPhone(raw: string): { countryCode: string; phone: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { countryCode: "ID", phone: "" };

  // A leading "+" means an explicit international number: peel the longest
  // known dial prefix. Dial codes are prefix-free, so the match is unambiguous.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    for (let len = 4; len >= 1; len--) {
      const candidate = digits.slice(0, len);
      const match = DIAL_TO_CODE.get(candidate);
      if (match) return { countryCode: match, phone: digits.slice(len) };
    }
    return { countryCode: "ID", phone: digits };
  }

  let digits = trimmed.replace(/\D/g, "");
  // A local Indonesian number: drop the trunk "0" and assume +62.
  if (digits.startsWith("0")) return { countryCode: "ID", phone: digits.slice(1) };
  // Bare digits that begin with a known dial prefix (e.g. "62812…").
  for (let len = 4; len >= 1; len--) {
    const candidate = digits.slice(0, len);
    const match = DIAL_TO_CODE.get(candidate);
    if (match) return { countryCode: match, phone: digits.slice(len) };
  }
  return { countryCode: "ID", phone: digits };
}

/**
 * Dial prefix → ISO code, used to reverse an international number. Countries
 * that share a prefix (the NANP "+1" family) resolve to their first entry.
 */
const DIAL_TO_CODE: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const c of COUNTRIES) {
    const dial = c.dialCode.replace(/\D/g, "");
    if (!map.has(dial)) map.set(dial, c.code);
  }
  return map;
})();

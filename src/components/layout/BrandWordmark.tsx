import type { BrandInfo } from "@/lib/branding";

/**
 * The document wordmark — the configured app name from the admin branding
 * setting, or the built-in "Our•Vacation" split around the accent dot.
 *
 * A custom name with a space splits the same way ("Java Trans" → "Java•Trans");
 * a single word keeps the dot as a full stop.
 */
export default function BrandWordmark({
  brand,
  dark = false,
  className = "",
}: {
  brand: BrandInfo;
  /** Dark text for light surfaces; white for dark ones. */
  dark?: boolean;
  className?: string;
}) {
  const name = brand.appName;
  const [start, end] = name
    ? name.includes(" ")
      ? [name.slice(0, name.indexOf(" ")), name.slice(name.indexOf(" ") + 1)]
      : [name, ""]
    : ["Our", "Vacation"];

  return (
    <span
      className={`inline-flex items-baseline text-2xl font-extrabold tracking-tight ${
        dark ? "text-ink" : "text-white"
      } ${className}`}
    >
      <span>{start}</span>
      <span className="mx-0.5 inline-block h-4 w-4 translate-y-0.5 rounded-full bg-accent" />
      {end ? <span>{end}</span> : null}
    </span>
  );
}

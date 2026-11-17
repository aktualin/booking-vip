// Resolve the app's "@/..." alias for the cart verification script —
// tries .ts, .tsx and /index.ts (the shared alias-hook only tries .ts).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") {
    return nextResolve(
      new URL("./next-headers-stub.mjs", import.meta.url).href,
      context,
    );
  }
  if (specifier.startsWith("@/")) {
    const base = new URL("../../src/" + specifier.slice(2), import.meta.url);
    for (const candidate of [
      base.href + ".ts",
      base.href + ".tsx",
      base.href + "/index.ts",
    ]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // try the next candidate
      }
    }
  }
  return nextResolve(specifier, context);
}

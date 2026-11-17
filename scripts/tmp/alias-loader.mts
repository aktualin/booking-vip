// Maps the app's "@/…" alias to src/…ts for plain-node script runs.
// Usage: node --experimental-strip-types --import ./scripts/tmp/alias-loader.mts <script>
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    // server-only throws outside a react-server bundle — stub it for scripts.
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {}", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const target = path.join(root, "src", specifier.slice(2));
      return nextResolve(pathToFileURL(`${target}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});
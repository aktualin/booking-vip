import type { NextConfig } from "next";

// Public host of the R2 bucket (custom domain) — derived from
// CLOUDFLARE_S3_ENDPOINT so `next/image` only accepts exactly that host.
// An r2.cloudflarestorage.com value is an S3 API, not a public domain, and
// is ignored (images then use the same-origin /media proxy path).
const r2Host = (() => {
  try {
    const endpoint = process.env["CLOUDFLARE_S3_ENDPOINT"];
    if (!endpoint || endpoint.includes("r2.cloudflarestorage.com")) {
      return null;
    }
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  images: {
    // Load every image straight from its source URL (R2 custom domain
    // cdn.aktualin.com) — no _next/image optimizer hop. The browser talks to
    // the CDN directly; remotePatterns stays as the allow-list if
    // optimization is ever re-enabled.
    unoptimized: true,
    remotePatterns: r2Host
      ? [{ protocol: "https", hostname: r2Host }]
      : [{ protocol: "https", hostname: "pub-**.r2.dev" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

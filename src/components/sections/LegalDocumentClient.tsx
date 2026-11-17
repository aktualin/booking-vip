"use client";

import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";

/**
 * Renders an admin-authored legal document (Terms of Service / Privacy
 * Policy) from its stored HTML.
 *
 * DOMPurify needs a DOM, so sanitizing during SSR throws and forces a
 * client-render fallback. Render a tag-stripped plain-text version on the
 * server and on the first client render (hydration matches), then swap in
 * the sanitized HTML once mounted — the same pattern the transport detail
 * page uses.
 */
export default function LegalDocumentClient({ html }: { html: string }) {
  const plainText = useMemo(
    () => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    [html],
  );
  const [safeHtml, setSafeHtml] = useState<string | null>(null);

  useEffect(() => {
    setSafeHtml(DOMPurify.sanitize(html));
  }, [html]);

  if (!html.trim() || html === "<p></p>") {
    return (
      <p className="text-sm text-ink/60">
        Dokumen ini sedang disusun. Silakan hubungi kami untuk informasi lebih
        lanjut.
      </p>
    );
  }

  if (safeHtml === null) {
    return <p className="text-sm leading-relaxed text-ink/70">{plainText}</p>;
  }

  return (
    <div
      className="rich-text max-w-none text-[15px] text-ink/80 [&_a]:text-brand"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

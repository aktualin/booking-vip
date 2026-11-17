"use client";

import Container from "@/components/ui/Container";
import { copyText } from "@/lib/content";
import { useMountedLocale } from "@/lib/useMountedLocale";
import type { SeoBlockDTO } from "@/types";

/**
 * SEO body copy. Strictly DB-backed (`SeoBlock` table) — the copy is
 * bilingual and resolved in the active language on the client. When the
 * database has no active blocks the section renders nothing at all; there is
 * no static fallback content.
 */
export default function SeoContent({ blocks }: { blocks?: SeoBlockDTO[] }) {
  const { lang } = useMountedLocale();

  if (!blocks || blocks.length === 0) return null;

  return (
    <section className="bg-canvas">
      <Container className="space-y-10 py-12">
        {blocks.map((block) => (
          <div key={block.slug}>
            <h2 className="mb-5 text-xl font-extrabold text-ink md:text-2xl">
              {copyText(block.title, lang)}
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              {block.sections.map((s) => (
                <div key={s.heading.en}>
                  <h3 className="mb-2 text-base font-bold text-ink">
                    {copyText(s.heading, lang)}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted">
                    {copyText(s.body, lang)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Container>
    </section>
  );
}

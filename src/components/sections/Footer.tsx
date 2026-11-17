"use client";

import Link from "next/link";
import Container from "@/components/ui/Container";
import Logo from "@/components/layout/Logo";
import { serviceNav } from "@/data/services";
import { useLocale } from "@/components/providers/LocaleProvider";
import { SERVICE_LABEL_KEYS } from "@/lib/serviceLabels";
import type { DictKey } from "@/i18n";

/**
 * Site footer — logo, the real service routes and the copyright line only.
 *
 * Everything else that used to live here (dummy contact details, partner and
 * award placeholders, dead social links, payment brand badges and the
 * Company/Support link columns pointing at "#") was static placeholder
 * content with no relation to the business, so it is gone.
 */
export default function Footer() {
  const { t } = useLocale();

  return (
    <footer className="bg-[#0b1b2b] text-white/80">
      <Container className="py-12">
        <div className="grid gap-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <Logo />
          </div>

          {/* The Services column lists exactly the navigable service lines. */}
          <div>
            <h3 className="mb-3 text-sm font-bold text-white">
              {t("footer.services")}
            </h3>
            <ul className="space-y-2 text-sm">
              {serviceNav.map((s) => {
                const key: DictKey | undefined = SERVICE_LABEL_KEYS[s.label];
                return (
                  <li key={s.href}>
                    <Link href={s.href} className="hover:text-white">
                      {key ? t(key) : s.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <p className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-white/50">
          {t("footer.copyright")}
        </p>
      </Container>
    </footer>
  );
}

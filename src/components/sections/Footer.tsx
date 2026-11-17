import Link from "next/link";
import Container from "@/components/ui/Container";
import Logo from "@/components/layout/Logo";
import FooterNav from "@/components/sections/FooterNav";
import { FacebookIcon, InstagramIcon, WhatsAppIcon } from "@/components/icons";
import { getSiteInfo, renderCopyright, whatsAppLink } from "@/lib/site-settings";

/**
 * Site footer — the admin-configurable company identity (name, address and
 * social links), the real service routes, the legal documents and the
 * copyright line with a dynamic year.
 *
 * A server component: it reads the `site.info` setting straight from the
 * database, so every page keeps rendering `<Footer />` unchanged. The
 * locale-dependent link columns live in the client `FooterNav`.
 */
export default async function Footer() {
  const site = await getSiteInfo();

  const waHref = whatsAppLink(site.whatsapp);
  const socials = [
    site.instagram
      ? { key: "instagram", href: site.instagram, label: "Instagram", icon: <InstagramIcon size={17} /> }
      : null,
    waHref
      ? { key: "whatsapp", href: waHref, label: "WhatsApp", icon: <WhatsAppIcon size={17} /> }
      : null,
    site.facebook
      ? { key: "facebook", href: site.facebook, label: "Facebook", icon: <FacebookIcon size={17} /> }
      : null,
  ].filter((s) => s !== null);

  return (
    <footer className="bg-[#0b1b2b] text-white/80">
      <Container className="py-12">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          {/* Company identity */}
          <div>
            <Logo />
            {site.companyName ? (
              <p className="mt-4 text-sm font-semibold text-white">
                {site.companyName}
              </p>
            ) : null}
            {site.address ? (
              <address className="mt-1.5 max-w-sm text-sm not-italic leading-relaxed text-white/60">
                {site.address}
              </address>
            ) : null}
            {socials.length > 0 ? (
              <div className="mt-4 flex items-center gap-3">
                {socials.map((s) => (
                  <Link
                    key={s.key}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    title={s.label}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    {s.icon}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          {/* Services + Legal columns (locale-aware, client) */}
          <FooterNav />
        </div>

        <p className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-white/50">
          {renderCopyright(site.copyrightText, site.companyName)}
        </p>
      </Container>
    </footer>
  );
}

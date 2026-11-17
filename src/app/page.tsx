import { Suspense } from "react";
import { connection } from "next/server";
import { ArticleCard, PromoCard, ProductCard } from "@/components/cards";
import BottomTabBar from "@/components/sections/BottomTabBar";
import BannerStrip from "@/components/sections/BannerStrip";
import Footer from "@/components/sections/Footer";
import HeroSearch from "@/components/sections/HeroSearch";
import HomePopup from "@/components/sections/HomePopup";
import RecentSearches from "@/components/sections/RecentSearches";
import SectionBand from "@/components/sections/SectionBand";
import SeoContent from "@/components/sections/SeoContent";
import SeoLinkGrid from "@/components/sections/SeoLinkGrid";
// import StickyAppBanner from "@/components/sections/StickyAppBanner";
import Carousel from "@/components/ui/Carousel";
import Header from "@/components/layout/Header";
import { getHomeContent } from "@/app/actions/content";
import { serviceNav } from "@/data/services";
import type { CatalogDTO, CopyDTO, HomeContentDTO, SeoLinkDTO } from "@/types";
import type { DictKey } from "@/i18n";

/** Bilingual links of a `SeoLink` group, in the shape `SeoLinkGrid` expects. */
function seoLinksOf(links: SeoLinkDTO[], group: string) {
  return links
    .filter((l) => l.group === group)
    .map((l) => ({ label: l.label.en, labelId: l.label.id, service: l.service ?? "", tags: l.tags, href: l.href }));
}

/** "All" + the distinct `service` values of a `SeoLink` group. */
function seoTabsOf(links: SeoLinkDTO[], group: string): string[] {
  const services = [...new Set(links.filter((l) => l.group === group).map((l) => l.service).filter((s): s is string => !!s))];
  return ["All", ...services];
}

/** The products of a line, straight from its DB-backed catalog. */
function lineProducts(content: HomeContentDTO | null, slug: string): CatalogDTO["products"] {
  return content?.catalogs[slug]?.products ?? [];
}

/** The bilingual filter tabs of a line (DB `ServiceLine.tabs`). */
function lineTabs(content: HomeContentDTO | null, slug: string): CopyDTO[] {
  return content?.lines.find((l) => l.slug === slug)?.tabs ?? [];
}

/**
 * The product bands of the home page, in the original carousel style. One
 * band per service line that actually has products in its DB catalog — the
 * copy keys and routes are the line's own, nothing is hardcoded content.
 */
const PRODUCT_BANDS: {
  slug: string;
  eyebrow: string;
  title: string;
  seeAll: string;
  seeAllHref: string;
  eyebrowKey: DictKey;
  titleKey: DictKey;
  seeAllKey: DictKey;
}[] = [
  {
    slug: "vip-service",
    eyebrow: "Airport VIP Service ✈️",
    title: "Breeze through the airport",
    seeAll: "See all VIP services",
    seeAllHref: "/vip-service",
    eyebrowKey: "home.vipEyebrow",
    titleKey: "home.vipTitle",
    seeAllKey: "home.vipSeeAll",
  },
  {
    slug: "transport",
    eyebrow: "Transport 🚘",
    title: "Private transfers & chauffeur service",
    seeAll: "See all transport",
    seeAllHref: "/transport",
    eyebrowKey: "home.transportEyebrow",
    titleKey: "home.transportTitle",
    seeAllKey: "home.transportSeeAll",
  },
  {
    slug: "tour-package",
    eyebrow: "Tour Package 🗺️",
    title: "Curated tours across Indonesia",
    seeAll: "See all tours",
    seeAllHref: "/tour-package",
    eyebrowKey: "home.tourEyebrow",
    titleKey: "home.tourTitle",
    seeAllKey: "home.tourSeeAll",
  },
  {
    slug: "evoa",
    eyebrow: "eVOA 🛂",
    title: "Electronic Visa on Arrival, made easy",
    seeAll: "Check eligibility",
    seeAllHref: "/evoa",
    eyebrowKey: "home.evoaEyebrow",
    titleKey: "home.evoaTitle",
    seeAllKey: "home.evoaSeeAll",
  },
];

/**
 * The home page.
 *
 * The shell (header, hero, footer) stays static; everything fed by the
 * database is streamed from `HomeBody` inside a Suspense boundary, because a
 * DB read during prerender is not allowed under `cacheComponents`.
 */
export default function Home() {
  return (
    <div className="bg-white pb-20 lg:pb-0">
      <Header />
      <HomePopup />
      <HeroSearch />
      <RecentSearches />

      <Suspense fallback={<HomeBodySkeleton />}>
        <HomeBody />
      </Suspense>

      <Footer />
      <BottomTabBar />
      {/* <StickyAppBanner /> */}
    </div>
  );
}

/** The placeholder shown while the DB-backed sections stream in. */
function HomeBodySkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-8 px-4 py-10 sm:px-6">
      {[0, 1, 2].map((row) => (
        <div key={row}>
          <div className="mb-4 h-6 w-64 rounded-lg bg-canvas" />
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3].map((card) => (
              <div key={card} className="h-56 w-[260px] shrink-0 rounded-xl bg-canvas" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Everything on the home page that comes from the database.
 *
 * Single-service home: only the Airport VIP Service is featured (the other
 * lines keep their routes but are no longer shown here). Every section here
 * is strictly DB-driven — promos, banners, articles and the SEO sections
 * render nothing when the database has no active rows; there is no static
 * fallback content.
 */
async function HomeBody() {
  await connection();

  const content = await getHomeContent();

  const promos = content?.promos ?? [];
  const banners = content?.banners ?? [];
  const articles = content?.articles ?? [];

  const seoLinks = content?.seoLinks ?? [];
  const recommendationLinks = seoLinksOf(seoLinks, "recommendations");
  const recommendationTabs = seoTabsOf(seoLinks, "recommendations");
  const serviceSeoLinks = seoLinksOf(seoLinks, "services");
  const serviceSeoTabs = seoTabsOf(seoLinks, "services");

  // Banners are positional: [fast track, eVOA (not rendered), corporate].
  const [fastTrackBanner, , corporateBanner] = banners;

  // Promos are scoped to a service line: only lines reachable from the nav
  // get a tab. The VIP nav entry points at the booking tool (/airport-vip)
  // while its DB line slug stays `vip-service` — the same alias HeroSearch
  // and BookingPanel use.
  const navSlugs = new Set(serviceNav.map((s) => s.href.replace(/^\//, "")));
  const visibleLines = (content?.lines ?? []).filter(
    (l) =>
      navSlugs.has(l.slug) ||
      (l.slug === "vip-service" && navSlugs.has("airport-vip"))
  );
  const promoTabs = ["All", ...new Set(visibleLines.map((l) => l.label))];

  /** One product band per line — rendered only when its catalog has products. */
  const band = (slug: string) => {
    const spec = PRODUCT_BANDS.find((b) => b.slug === slug);
    const products = lineProducts(content, slug);
    if (!spec || products.length === 0) return null;
    return (
      <SectionBand
        eyebrow={spec.eyebrow}
        title={spec.title}
        tabsCopy={lineTabs(content, slug)}
        seeAll={spec.seeAll}
        seeAllHref={spec.seeAllHref}
        eyebrowKey={spec.eyebrowKey}
        titleKey={spec.titleKey}
        seeAllKey={spec.seeAllKey}
      >
        <Carousel>
          {products.map((p) => (
            <ProductCard key={p.slug} product={p} href={`/${slug}/${p.slug}`} />
          ))}
        </Carousel>
      </SectionBand>
    );
  };

  return (
    <>
      {/* Special deals */}
      {promos.length > 0 ? (
        <SectionBand title="Special deals" emoji="🎉" titleKey="home.specialDeals" seeAllKey="section.seeAll">
          <Carousel>
            {promos.map((p) => (
              <PromoCard key={p.slug} promo={p} />
            ))}
          </Carousel>
        </SectionBand>
      ) : null}

      {/* Airport VIP Service — our products, original carousel style */}
      {band("vip-service")}

      {/* Fast Track banner — DB-driven, hidden when there is no active banner */}
      {fastTrackBanner ? (
        <BannerStrip
          title={fastTrackBanner.title.en}
          tone={fastTrackBanner.tone ?? "from-sky-600 to-blue-800"}
          compact
          titleCopy={fastTrackBanner.title}
          subtitleCopy={fastTrackBanner.subtitle}
          ctaCopy={fastTrackBanner.cta}
          imageUrl={fastTrackBanner.imageUrl}
          href={fastTrackBanner.ctaHref ?? "/airport-vip"}
        />
      ) : null}

      {/* Transport — our products */}
      {band("transport")}

      {/* Tour Package — our products */}
      {band("tour-package")}

      {/* Promos */}
      {promos.length > 0 ? (
        <SectionBand
          title="Check out the promos before you go"
          emoji="🤩"
          tabs={promoTabs}
          seeAll="See all promos"
          titleKey="home.promosTitle"
          seeAllKey="home.promosSeeAll"
        >
          <Carousel>
            {promos.map((p) => (
              <PromoCard key={`pr-${p.slug}`} promo={p} />
            ))}
          </Carousel>
        </SectionBand>
      ) : null}

      {/* eVOA — our products */}
      {band("evoa")}

      {/* Corporate banner — DB-driven, hidden when there is no active banner */}
      {corporateBanner ? (
        <BannerStrip
          title={corporateBanner.title.en}
          tone={corporateBanner.tone ?? "from-slate-700 to-slate-900"}
          compact
          titleCopy={corporateBanner.title}
          subtitleCopy={corporateBanner.subtitle}
          ctaCopy={corporateBanner.cta}
          imageUrl={corporateBanner.imageUrl}
          href={corporateBanner.ctaHref}
        />
      ) : null}

      {/* Articles / guides */}
      {articles.length > 0 ? (
        <SectionBand title="Travel guides & tips" emoji="📖" titleKey="home.articlesTitle" seeAllKey="section.seeAll">
          <Carousel>
            {articles.map((a) => (
              <ArticleCard key={a.slug} article={a} />
            ))}
          </Carousel>
        </SectionBand>
      ) : null}

      {/* SEO content */}
      <SeoContent blocks={content?.seoBlocks} />

      {/* SEO link grids — DB-driven, hidden when a group has no active links */}
      {recommendationLinks.length > 0 ? (
        <SeoLinkGrid
          title="Our Recommendations"
          tabs={recommendationTabs}
          links={recommendationLinks}
          titleKey="home.recommendationsTitle"
        />
      ) : null}
      {serviceSeoLinks.length > 0 ? (
        <SeoLinkGrid
          title="Explore Our Services"
          tabs={serviceSeoTabs}
          links={serviceSeoLinks}
          titleKey="home.exploreServicesTitle"
        />
      ) : null}
    </>
  );
}

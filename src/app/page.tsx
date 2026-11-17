import { Suspense } from "react";
import { connection } from "next/server";
import { ArticleCard, PromoCard } from "@/components/cards";
import AirportVipFeature from "@/components/sections/AirportVipFeature";
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
import {
  recommendationLinks as staticRecommendationLinks,
  recommendationTabs as staticRecommendationTabs,
  serviceSeoLinks as staticServiceSeoLinks,
  serviceSeoTabs as staticServiceSeoTabs,
} from "@/data/home";
import { serviceNav } from "@/data/services";
import type { SeoLinkDTO } from "@/types";

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
 * lines keep their routes but are no longer shown here). Promos, banners,
 * articles and the SEO sections stay DB-driven.
 */
async function HomeBody() {
  await connection();

  const content = await getHomeContent();

  const promos = content && content.promos.length > 0 ? content.promos : [];
  const banners = content?.banners ?? [];
  const articles = content && content.articles.length > 0 ? content.articles : [];

  const recommendationLinks =
    content && content.seoLinks.length > 0
      ? seoLinksOf(content.seoLinks, "recommendations")
      : staticRecommendationLinks;
  const recommendationTabs =
    content && content.seoLinks.length > 0
      ? seoTabsOf(content.seoLinks, "recommendations")
      : staticRecommendationTabs;
  const serviceSeoLinks =
    content && content.seoLinks.length > 0
      ? seoLinksOf(content.seoLinks, "services")
      : staticServiceSeoLinks;
  const serviceSeoTabs =
    content && content.seoLinks.length > 0
      ? seoTabsOf(content.seoLinks, "services")
      : staticServiceSeoTabs;

  // Banners are positional: [fast track, eVOA (hidden), corporate].
  const [fastTrackBanner, , corporateBanner] = banners;

  // Promos are scoped to a service line, but the home is single-service now:
  // only the visible line gets a tab. The nav entry points at the booking
  // tool (/airport-vip) while its DB line slug stays `vip-service` — the
  // same alias HeroSearch and BookingPanel use.
  const navSlugs = new Set(serviceNav.map((s) => s.href.replace(/^\//, "")));
  const visibleLines = (content?.lines ?? []).filter(
    (l) =>
      navSlugs.has(l.slug) ||
      (l.slug === "vip-service" && navSlugs.has("airport-vip"))
  );
  const promoTabs = ["All", ...new Set(visibleLines.map((l) => l.label))];

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

      {/* Airport VIP Service — the single featured service */}
      <SectionBand
        eyebrow="Airport VIP Service ✈️"
        title="Breeze through the airport"
        seeAll="Book VIP service"
        seeAllHref="/airport-vip"
        eyebrowKey="home.vipEyebrow"
        titleKey="home.vipTitle"
        seeAllKey="home.vipSeeAll"
      >
        <AirportVipFeature />
      </SectionBand>

      {/* Fast Track banner */}
      <BannerStrip
        title="Skip the queues with Fast Track Immigration"
        subtitle="A dedicated greeter and priority lanes, from arrival to departure"
        cta="Book VIP"
        tone="from-sky-600 to-blue-800"
        compact
        titleKey="banner.fastTrackTitle"
        subtitleKey="banner.fastTrackSubtitle"
        ctaKey="banner.fastTrackCta"
        titleCopy={fastTrackBanner?.title}
        subtitleCopy={fastTrackBanner?.subtitle}
        ctaCopy={fastTrackBanner?.cta}
        imageUrl={fastTrackBanner?.imageUrl}
        href={fastTrackBanner?.ctaHref ?? "/airport-vip"}
      />

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

      {/* Corporate banner */}
      <BannerStrip
        title="Booking VIP for Corporate"
        subtitle="VIP travel management for your executives and guests"
        cta="Learn more"
        tone="from-slate-700 to-slate-900"
        compact
        titleKey="banner.corporateTitle"
        subtitleKey="banner.corporateSubtitle"
        ctaKey="banner.corporateCta"
        titleCopy={corporateBanner?.title}
        subtitleCopy={corporateBanner?.subtitle}
        ctaCopy={corporateBanner?.cta}
        imageUrl={corporateBanner?.imageUrl}
        href={corporateBanner?.ctaHref}
      />

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

      {/* SEO link grids */}
      <SeoLinkGrid
        title="Our Recommendations"
        tabs={recommendationTabs}
        links={recommendationLinks}
        titleKey="home.recommendationsTitle"
      />
      <SeoLinkGrid
        title="Explore Our Services"
        tabs={serviceSeoTabs}
        links={serviceSeoLinks}
        titleKey="home.exploreServicesTitle"
      />
    </>
  );
}

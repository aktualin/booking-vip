"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import Container from "@/components/ui/Container";
import Badge from "@/components/ui/Badge";
import TabPills from "@/components/ui/TabPills";
import Thumb from "@/components/ui/Thumb";
import type { PackageDTO, ProductDetailDTO } from "@/types";
import { getProduct } from "@/app/actions/catalog";
import { pickLang } from "@/lib/content";
import { useLocale } from "@/components/providers/LocaleProvider";

/**
 * The tour detail — hero, package selector, day-by-day itinerary and the
 * include / exclude lists. The CTA keeps the existing flow: it hands the
 * chosen package to the map step (`/tour-package/search`), which forwards
 * the route to the booking wizard.
 *
 * Fetched client-side from the DB, the same way `ProductDetail` does.
 */
export default function TourDetailClient() {
  const params = useParams();
  const slug = params.slug as string;
  const searchParams = useSearchParams();
  const { t, lang, formatMoney } = useLocale();

  const [product, setProduct] = useState<ProductDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [packageId, setPackageId] = useState("");
  const [infoTab, setInfoTab] = useState(0);
  const [dayTab, setDayTab] = useState(0);

  useEffect(() => {
    setLoading(true);
    getProduct(slug).then((data) => {
      setProduct(data);
      setPackageId(data?.packages[0]?.id ?? "");
      setDayTab(0);
      setInfoTab(0);
      setLoading(false);
    });
  }, [slug]);

  const selected = useMemo(
    () => product?.packages.find((pkg) => pkg.id === packageId) ?? product?.packages[0] ?? null,
    [product, packageId],
  );

  /** The price of one unit / one adult of a package, with its price label. */
  const priceOf = (pkg: PackageDTO): { usd: number; label: string } => {
    if (pkg.unitKind === "per_pax") {
      return { usd: pkg.adultUsd ?? 0, label: t("tour.perPax") };
    }
    if (pkg.unitKind === "per_day") {
      return { usd: pkg.unitUsd ?? pkg.adultUsd ?? 0, label: t("tour.perDay") };
    }
    return { usd: pkg.unitUsd ?? pkg.adultUsd ?? 0, label: t("tour.perUnit") };
  };

  /** The CTA — the map step keeps the package and the search context. */
  const ctaHref = useMemo(() => {
    if (!product || !selected) return "/tour-package/search";
    const query = new URLSearchParams();
    query.set("package", `${product.slug}::${selected.id}`);
    const date = searchParams?.get("date");
    if (date) query.set("date", date);
    query.set("adults", searchParams?.get("adults") ?? "2");
    query.set("children", searchParams?.get("children") ?? "0");
    query.set("infants", searchParams?.get("infants") ?? "0");
    const kind = searchParams?.get("kind");
    if (kind) query.set("kind", kind);
    return `/tour-package/search?${query.toString()}`;
  }, [product, selected, searchParams]);

  if (loading) {
    return (
      <Container className="py-10">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-3/4 rounded bg-canvas" />
          <div className="h-4 w-1/2 rounded bg-canvas" />
          <div className="h-64 rounded bg-canvas" />
        </div>
      </Container>
    );
  }

  if (!product || product.lineSlug !== "tour-package") {
    return (
      <Container className="py-10">
        <div className="rounded-xl border border-line bg-canvas p-8 text-center">
          <p className="text-lg font-semibold text-ink">{t("product.notFoundTitle")}</p>
          <p className="mt-2 text-sm text-muted">{t("product.notFoundDesc")}</p>
          <Link
            href="/tour-package"
            className="mt-4 inline-block rounded-xl bg-brand px-6 py-2 text-sm font-bold text-white hover:bg-brand-dark"
          >
            {t("product.backTo", { line: "tour-package" })}
          </Link>
        </div>
      </Container>
    );
  }

  // Bilingual copy — the Indonesian variant is picked on the client;
  // English is used when it is absent.
  const title = pickLang(product.title, product.titleId, lang);
  const description = pickLang(product.description, product.descriptionId, lang);
  const destination = pickLang(product.destinationLabel ?? "", product.destinationLabelId, lang);
  const typeLabel = pickLang(product.typeLabel, product.typeLabelId, lang);
  const durationLabel = product.durationLabel
    ? pickLang(product.durationLabel, product.durationLabelId, lang)
    : product.durationDays && product.durationDays > 0
      ? t("tour.durationDays", { n: product.durationDays })
      : t("tour.dayTour");
  const requirements =
    lang === "id" && product.requirementsId?.length
      ? product.requirementsId
      : product.requirements;
  const included =
    lang === "id" && product.includedId?.length ? product.includedId : product.included;
  const notIncluded =
    lang === "id" && product.notIncludedId?.length
      ? product.notIncludedId
      : product.notIncluded;

  const itinerary = product.itinerary ?? [];
  const activeDay = itinerary[Math.min(dayTab, itinerary.length - 1)];
  const minPax = product.minPax ?? 1;
  const maxPax = product.maxPax ?? null;
  const selectedPrice = selected ? priceOf(selected) : null;

  const infoTabs = [t("product.included"), t("product.notIncluded")];
  const infoLists = [included, notIncluded];

  return (
    <Container className="py-10">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-brand">{t("product.home")}</Link>
        <span>›</span>
        <Link href="/tour-package" className="hover:text-brand">{t("nav.tourPackage")}</Link>
        <span>›</span>
        <span className="text-ink">{title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        {/* Left column: content */}
        <div>
          {/* Title + badges */}
          <div className="mb-4">
            <h1 className="text-2xl font-extrabold text-ink md:text-3xl">{title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {product.tourKind ? (
                <Badge variant={product.tourKind === "private" ? "brand" : "soft"}>
                  {t(product.tourKind === "private" ? "tour.kindPrivate" : "tour.kindJoinIn")}
                </Badge>
              ) : null}
              <Badge variant="light">{durationLabel}</Badge>
              {minPax > 1 ? (
                <Badge variant="light">{t("tour.minPaxBadge", { n: minPax })}</Badge>
              ) : null}
              {maxPax != null ? (
                <Badge variant="light">{t("tour.maxPaxBadge", { n: maxPax })}</Badge>
              ) : null}
              {product.rating != null ? (
                <Badge variant="soft">
                  ★ {product.rating.toFixed(1)}
                  {product.reviews ? ` · ${t("tour.reviewsCount", { n: product.reviews })}` : ""}
                </Badge>
              ) : null}
            </div>
          </div>

          {/* Attribute row */}
          <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-muted">
            {destination ? (
              <span className="flex items-center gap-1">📍 {destination}</span>
            ) : null}
            {typeLabel ? (
              <span className="flex items-center gap-1">🧭 {typeLabel}</span>
            ) : null}
            <span className="flex items-center gap-1">⏱️ {durationLabel}</span>
          </div>

          {/* Hero image */}
          <div className="mb-6 h-64 w-full overflow-hidden rounded-xl md:h-80">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={title}
                className="h-full w-full object-cover"
              />
            ) : (
              <Thumb tone={product.tone} className="h-full w-full" />
            )}
          </div>

          {/* Description */}
          {description ? (
            <div className="mb-6">
              <h2 className="mb-2 text-lg font-extrabold text-ink">{t("product.about")}</h2>
              <p className="text-sm leading-relaxed text-muted">{description}</p>
            </div>
          ) : null}

          {/* Package selector */}
          {product.packages.length > 0 ? (
            <div className="mb-6">
              <h2 className="mb-2 text-lg font-extrabold text-ink">{t("tour.packagesTitle")}</h2>
              <div className="space-y-2.5">
                {product.packages.map((pkg) => {
                  const active = selected?.id === pkg.id;
                  const price = priceOf(pkg);
                  const label = pickLang(pkg.label, pkg.labelId, lang);
                  const pkgDescription = pkg.description
                    ? pickLang(pkg.description, pkg.descriptionId, lang)
                    : "";
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setPackageId(pkg.id)}
                      className={`flex w-full items-start justify-between gap-4 rounded-xl border p-4 text-left transition-colors ${
                        active
                          ? "border-brand bg-brand-soft"
                          : "border-line bg-white hover:bg-canvas"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold text-ink">{label}</span>
                        {pkgDescription ? (
                          <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                            {pkgDescription}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-[12px] text-muted">
                          {pkg.durationHours ? t("tour.hours", { n: pkg.durationHours }) : null}
                          {pkg.durationHours && pkg.extraHourUsd
                            ? ` · ${t("tour.overtime", { price: formatMoney(pkg.extraHourUsd) })}`
                            : null}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {pkg.fromUsd != null && pkg.fromUsd > price.usd ? (
                          <span className="block text-[11px] text-muted line-through">
                            {formatMoney(pkg.fromUsd)}
                          </span>
                        ) : null}
                        <span className="block text-[14px] font-bold text-ink">
                          {formatMoney(price.usd)}
                        </span>
                        <span className="block text-[11px] text-muted">{price.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Day-by-day itinerary */}
          {itinerary.length > 0 ? (
            <div className="mb-6">
              <h2 className="mb-2 text-lg font-extrabold text-ink">{t("tour.itinerary")}</h2>
              {itinerary.length > 1 ? (
                <TabPills
                  items={itinerary.map((day) => t("tour.day", { n: day.day }))}
                  active={Math.min(dayTab, itinerary.length - 1)}
                  onChange={setDayTab}
                  variant="bordered"
                  className="mb-3"
                />
              ) : null}
              {activeDay ? (
                <div className="rounded-xl border border-line bg-white p-4">
                  <p className="text-[13px] font-bold text-ink">
                    {t("tour.day", { n: activeDay.day })} — {pickLang(activeDay.title, activeDay.titleId, lang)}
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {activeDay.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-3 text-[13px]">
                        <span className="w-12 shrink-0 font-mono text-[12px] font-semibold text-brand">
                          {item.time}
                        </span>
                        <span className="text-muted">
                          {pickLang(item.activity, item.activityId, lang)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Included / Not Included tabs */}
          {included.length > 0 || notIncluded.length > 0 ? (
            <div className="mb-6">
              <TabPills
                items={infoTabs}
                active={infoTab}
                onChange={setInfoTab}
                variant="bordered"
                className="mb-3"
              />
              <ul className="space-y-1.5 text-sm text-muted">
                {infoLists[infoTab]?.length ? (
                  infoLists[infoTab].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={infoTab === 0 ? "text-success" : "text-danger"}>
                        {infoTab === 0 ? "✓" : "✗"}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-muted">{t("product.none")}</li>
                )}
              </ul>
            </div>
          ) : null}

          {/* Requirements */}
          {requirements.length > 0 ? (
            <div className="mb-6">
              <h2 className="mb-2 text-lg font-extrabold text-ink">{t("product.requirements")}</h2>
              <ul className="space-y-1.5 text-sm text-muted">
                {requirements.map((req, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-brand">•</span>
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Right column: the booking CTA + pickup info */}
        <div>
          <div className="space-y-4 lg:sticky lg:top-24">
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                {t("tour.packagesTitle")}
              </p>
              <p className="mt-1 text-[15px] font-bold text-ink">
                {selected ? pickLang(selected.label, selected.labelId, lang) : "—"}
              </p>
              {selectedPrice ? (
                <p className="mt-2 text-[22px] font-extrabold text-ink">
                  {formatMoney(selectedPrice.usd)}
                  <span className="ml-1.5 text-[12px] font-medium text-muted">
                    {selectedPrice.label}
                  </span>
                </p>
              ) : null}
              <Link
                href={ctaHref}
                className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand px-6 text-[14px] font-semibold text-white transition-opacity hover:bg-brand-dark"
              >
                {t("tour.bookCta")}
              </Link>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">
                {product.tourKind === "join_in" ? t("tour.joinInHint") : t("tour.privateHint")}
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="text-[13px] font-bold text-ink">🚐 {t("tour.pickupTitle")}</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                {t("tour.pickupNote")}
              </p>
              {destination ? (
                <p className="mt-3 border-t border-line pt-3 text-[12px] text-muted">
                  {t("tour.destination")}: <span className="font-semibold text-ink">{destination}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
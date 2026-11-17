"use client";

import Link from "next/link";
import { useMemo } from "react";
import Badge from "@/components/ui/Badge";
import Thumb from "@/components/ui/Thumb";
import { useLocale } from "@/components/providers/LocaleProvider";
import { pickLang } from "@/lib/content";
import type { TourPackageGroupDTO } from "@/app/actions/catalog";

export type TourPackageSearch = {
  destination?: string;
  date?: string;
  adults?: string;
  children?: string;
  infants?: string;
  type?: string;
  /** "private" | "join_in" — how the tour is sold. */
  kind?: string;
};

/**
 * The package list — the result of "Cari paket".
 *
 * The price is computed from the passenger counts, so the customer sees the
 * price they will actually pay before the booking step.
 */
export default function TourPackageListClient({
  groups,
  search,
}: {
  groups: TourPackageGroupDTO[];
  search: TourPackageSearch;
}) {
  const { formatMoney, lang, t } = useLocale();

  const adults = Number(search.adults ?? "2") || 2;
  const children = Number(search.children ?? "0") || 0;
  const infants = Number(search.infants ?? "0") || 0;

  /** The packages that match the destination, the tour type and the kind. */
  const filtered = useMemo(() => {
    const destination = (search.destination ?? "").toLowerCase();
    const type = (search.type ?? "").toLowerCase();
    const kind = search.kind ?? "";

    return groups
      .map((group) => ({
        ...group,
        children: group.children.filter((tour) => {
          if (type && group.parentSlug !== type) return false;
          if (kind && tour.tourKind !== kind) return false;
          if (!destination) return true;
          const haystack = [
            tour.title,
            tour.packageLabel,
            tour.destinationName ?? "",
            tour.parentName ?? "",
            group.parentName,
          ]
            .join(" ")
            .toLowerCase();
          return destination.split(",")[0]?.trim() ? haystack.includes(destination.split(",")[0]!.trim()) : true;
        }),
      }))
      .filter((group) => group.children.length > 0);
  }, [groups, search.destination, search.type, search.kind]);

  const formatDate = (value?: string) => {
    if (!value) return "—";
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(date.getTime())) return value;
    return date.toLocaleDateString(lang === "id" ? "id-ID" : "en-US", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* The search summary */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              Destinasi
            </p>
            <p className="mt-0.5 font-semibold text-ink">
              {search.destination ?? "Semua destinasi"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              Tanggal mulai
            </p>
            <p className="mt-0.5 font-semibold text-ink">{formatDate(search.date)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              Penumpang
            </p>
            <p className="mt-0.5 font-semibold text-ink">
              {adults} dewasa
              {children > 0 ? `, ${children} anak` : ""}
              {infants > 0 ? `, ${infants} bayi` : ""}
            </p>
          </div>
          {search.kind ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                {t("tour.kindLabel")}
              </p>
              <p className="mt-0.5 font-semibold text-ink">
                {t(search.kind === "private" ? "tour.kindPrivate" : "tour.kindJoinIn")}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <Link
            href="/tour-package"
            className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-4 text-[12px] font-semibold text-ink transition-colors hover:bg-canvas"
          >
            Ubah pencarian
          </Link>
          <Link
            href="/tour-package/search"
            className="inline-flex h-9 items-center rounded-xl border border-line bg-white px-4 text-[12px] font-semibold text-ink transition-colors hover:bg-canvas"
          >
            Pilih titik jemput di peta
          </Link>
        </div>
      </section>

      {/* The packages */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center">
          <h2 className="text-[16px] font-bold text-ink">
            Belum ada paket untuk pencarian ini
          </h2>
          <p className="mt-1.5 text-[13px] text-muted">
            Coba ganti destinasi lain atau ubah tanggal perjalanan.
          </p>
        </div>
      ) : (
        filtered.map((group) => (
          <section
            key={group.parentSlug}
            className="rounded-2xl border border-line bg-white p-5"
          >
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">
              {group.parentName}
            </h2>

            <div className="mt-4 space-y-3">
              {group.children.map((tour) => {
                const key = `${tour.productSlug}::${tour.packageId}`;
                const perPax = tour.unitKind === "per_pax";
                // Per-pax packages show the party total; per-unit packages
                // show the price of one vehicle (one unit for a tour).
                const total = perPax
                  ? tour.adultUsdCents * adults +
                    tour.childUsdCents * children +
                    tour.infantUsdCents * infants
                  : tour.unitUsdCents;

                const title = pickLang(tour.title, tour.titleId, lang);
                const packageLabel = pickLang(tour.packageLabel, tour.packageLabelId, lang);
                const durationLabel = pickLang(tour.durationLabel ?? "", tour.durationLabelId, lang);
                const destinationName = pickLang(tour.destinationName ?? "", tour.destinationNameId, lang);

                const params = new URLSearchParams();
                params.set("package", key);
                if (search.date) params.set("date", search.date);
                params.set("adults", String(adults));
                params.set("children", String(children));
                params.set("infants", String(infants));
                if (search.kind) params.set("kind", search.kind);

                // The detail page carries the search context so its CTA can
                // hand the same selection back to the map step.
                const detailParams = new URLSearchParams();
                if (search.date) detailParams.set("date", search.date);
                detailParams.set("adults", String(adults));
                detailParams.set("children", String(children));
                detailParams.set("infants", String(infants));
                if (search.kind) detailParams.set("kind", search.kind);

                return (
                  <article
                    key={key}
                    className="flex flex-col gap-4 rounded-xl border border-line p-4 transition-colors hover:bg-canvas/60 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="hidden h-20 w-28 shrink-0 overflow-hidden rounded-lg sm:block">
                        {tour.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={tour.imageUrl}
                            alt={title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Thumb tone={tour.tone ?? "from-sky-400 to-blue-600"} className="h-full w-full" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {tour.tourKind ? (
                            <Badge variant={tour.tourKind === "private" ? "brand" : "soft"}>
                              {t(tour.tourKind === "private" ? "tour.kindPrivate" : "tour.kindJoinIn")}
                            </Badge>
                          ) : null}
                          {tour.minPax > 1 ? (
                            <Badge variant="light">
                              {t("tour.minPaxBadge", { n: tour.minPax })}
                            </Badge>
                          ) : null}
                        </div>
                        <h3 className="mt-1 text-[15px] font-bold tracking-[-0.01em] text-ink">
                          <Link
                            href={`/tour-package/${tour.productSlug}?${detailParams.toString()}`}
                            className="transition-colors hover:text-brand"
                          >
                            {title}
                          </Link>
                        </h3>
                        <p className="mt-0.5 text-[12px] text-muted">
                          {packageLabel}
                          {durationLabel ? ` · ${durationLabel}` : ""}
                          {destinationName ? ` · 📍 ${destinationName}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="text-right">
                        <p className="text-[15px] font-bold text-ink">
                          {formatMoney(total / 100)}
                        </p>
                        <p className="text-[11px] text-muted">
                          {perPax
                            ? `${formatMoney(tour.adultUsdCents / 100)} ${t("tour.perPax")}`
                            : t(tour.unitKind === "per_day" ? "tour.perDay" : "tour.perUnit")}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <Link
                          href={`/tour-package/search?${params.toString()}`}
                          className="inline-flex h-10 items-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
                        >
                          Pilih
                        </Link>
                        <Link
                          href={`/tour-package/${tour.productSlug}?${detailParams.toString()}`}
                          className="text-[12px] font-medium text-brand transition-opacity hover:opacity-80"
                        >
                          {t("tour.detail")}
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

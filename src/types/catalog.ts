// DTO types for DB-backed catalog data.

import type { TourItineraryDay } from "./tour";

export type ProductCardDTO = {
  slug: string;
  title: string;
  subtitle: string;
  priceUsd: number;
  fromUsd?: number;
  unit?: string;
  ribbon?: string;
  tone: string;
  imageUrl?: string | null;
  serviceTypeName?: string;
  placeName?: string;
  rating?: number;
  reviews?: number;
  durationLabel?: string;
  /**
   * Indonesian variants, resolved on the client via `useLocale()`. Optional:
   * English is used when absent, so static fallbacks keep working. Populated
   * from the `*Id` columns added by the catalog_i18n migration.
   */
  titleId?: string | null;
  subtitleId?: string | null;
  unitId?: string | null;
  ribbonId?: string | null;
  serviceTypeNameId?: string | null;
  placeNameId?: string | null;
  durationLabelId?: string | null;
};

export type PackageDTO = {
  id: string;
  label: string;
  /** Indonesian label — resolved on the client, EN when absent. */
  labelId?: string | null;
  unitKind: string;
  adultUsd?: number;
  childUsd?: number;
  infantUsd?: number;
  unitUsd?: number;
  durationHours?: number;
  extraHourUsd?: number;
  /** Package description — resolved on the client, EN when absent. */
  description?: string | null;
  descriptionId?: string | null;
  /** Strikethrough "from" price in USD, when the package is discounted. */
  fromUsd?: number;
};

export type AddOnDTO = {
  slug: string;
  label: string;
  /** Indonesian label — resolved on the client, EN when absent. */
  labelId?: string | null;
  unitUsd: number;
};

export type ProductDetailDTO = {
  slug: string;
  lineSlug: string;
  title: string;
  typeLabel: string;
  placeLabel: string;
  direction: string;
  leadTimeHours: number;
  leadTimeDays: number;
  description: string;
  included: string[];
  notIncluded: string[];
  requirements: string[];
  packages: PackageDTO[];
  addOns: AddOnDTO[];
  tone: string;
  ribbon?: string;
  fromUsd: number;
  /** Indonesian variants — see the note on `ProductCardDTO`. */
  titleId?: string | null;
  typeLabelId?: string | null;
  placeLabelId?: string | null;
  descriptionId?: string | null;
  ribbonId?: string | null;
  includedId?: string[] | null;
  notIncludedId?: string[] | null;
  requirementsId?: string[] | null;
  /** Tour: the day-by-day itinerary (empty for non-tour products). */
  itinerary?: TourItineraryDay[];
  /** Tour: "private" | "join_in" — null for non-tour products. */
  tourKind?: string | null;
  /** Tour: the minimum party size (adults + children). */
  minPax?: number;
  /** Tour: the maximum party size — null when unlimited. */
  maxPax?: number | null;
  /** Tour: 0 = day tour, otherwise the number of days. */
  durationDays?: number;
  durationLabel?: string | null;
  durationLabelId?: string | null;
  /** Tour destination (an Airport place) — EN + the optional ID variant. */
  destinationLabel?: string;
  destinationLabelId?: string | null;
  imageUrl?: string | null;
  rating?: number;
  reviews?: number;
};

export type CatalogDTO = {
  serviceTypes: { slug: string; name: string }[];
  places: { id: string; name: string }[];
  priceTiers: { label: string; maxUsd: number }[];
  products: ProductCardDTO[];
  source: "db" | "fallback";
};

export type OptionDTO = {
  value: string;
  label: string;
};

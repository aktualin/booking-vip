// DTO types for the admin area.
//
// Every amount is an integer number of USD cents, matching the database and
// the rest of the app (see CLAUDE.md — "Prices are integer USD cents").

import type { TourDepartureDTO, TourDriverDTO, TourItineraryDay, TourVehicleDTO } from "./tour";

export type AdminProductRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  lineId: string;
  lineLabel: string;
  serviceTypeId: string | null;
  serviceTypeName: string | null;
  airportId: string | null;
  airportName: string | null;
  direction: string;
  leadTimeHours: number;
  leadTimeDays: number;
  included: string[];
  notIncluded: string[];
  requirements: string[];
  isAddOn: boolean;
  imageUrl: string | null;
  tone: string;
  ribbon: string | null;
  rating: number | null;
  reviews: number | null;
  durationLabel: string | null;
  fromPriceUsdCents: number | null;
  /** Free-form vehicle specs — [{ key, name }]. */
  specs: { key: string; name: string }[];
  /** Tour only: "private" | "join_in" — null for non-tour products. */
  tourKind: string | null;
  /** Tour only: number of days (0 = day tour). */
  durationDays: number;
  /** Tour only: minimum paying passengers per booking. */
  minPax: number;
  /** Tour only: maximum passengers per booking / unit (null = no limit). */
  maxPax: number | null;
  /** The tour destination — a place row of kind "destination". */
  destinationId: string | null;
  destinationName: string | null;
  /** The day-by-day itinerary of a tour package. */
  itinerary: TourItineraryDay[];
  /** Indonesian title — null falls back to `title`. */
  titleId: string | null;
  /** Indonesian description — null falls back to `description`. */
  descriptionId: string | null;
  /** Indonesian duration label — null falls back to `durationLabel`. */
  durationLabelId: string | null;
  /** Indonesian ribbon — null falls back to `ribbon`. */
  ribbonId: string | null;
  /** Indonesian included list — null falls back to `included`. */
  includedId: string[] | null;
  /** Indonesian not-included list — null falls back to `notIncluded`. */
  notIncludedId: string[] | null;
  /** Indonesian requirements list — null falls back to `requirements`. */
  requirementsId: string[] | null;
  active: boolean;
  packageCount: number;
  /** Units the vendor owns (Product.stockTotal). */
  stockTotal: number;
  /** Derived: stockTotal − units reserved by active bookings. */
  availableStock: number;
};

export type AdminPackageRow = {
  id: string;
  productId: string;
  productTitle: string;
  label: string;
  unitKind: string;
  adultUsdCents: number | null;
  childUsdCents: number | null;
  infantUsdCents: number | null;
  unitUsdCents: number | null;
  durationHours: number | null;
  extraHourUsdCents: number | null;
  /** The strikethrough "from" price (USD cents) — null means no promo. */
  fromUsdCents: number | null;
  description: string | null;
  /** Indonesian package description — null falls back to `description`. */
  descriptionId: string | null;
  /** Free-form package info — [{ key, name, excluded? }]. */
  info: { key: string; name: string; excluded?: boolean }[];
  sortOrder: number;
  active: boolean;
};

/** A driver of the operator roster — admin list (includes inactive). */
export type AdminDriverRow = TourDriverDTO;

/** A vehicle of the operator roster — admin list (includes inactive). */
export type AdminVehicleRow = TourVehicleDTO;

/** A scheduled departure with availability and its product title. */
export type AdminDepartureRow = TourDepartureDTO & {
  productTitle: string;
};

export type AdminServiceTypeRow = {
  id: string;
  lineId: string;
  lineLabel: string;
  slug: string;
  name: string;
  sortOrder: number;
  active: boolean;
  productCount: number;
};

export type AdminPriceTierRow = {
  id: string;
  lineId: string | null;
  lineLabel: string | null;
  label: string;
  maxUsdCents: number;
  sortOrder: number;
  active: boolean;
};

export type AdminPlaceRow = {
  id: string;
  kind: string;
  /** Administrative level (region / country / province / city / district / village, or a leaf kind). */
  level: string;
  iataCode: string | null;
  name: string;
  city: string;
  country: string;
  imageUrl: string | null;
  active: boolean;
  /** The parent place (null for a root of the hierarchy). */
  parentId: string | null;
  /** The name of the parent place, for display. */
  parentName: string | null;
  /** Sort order inside the parent group. */
  sortOrder: number;
  productCount: number;
};

export type AdminServiceLineRow = {
  id: string;
  slug: string;
  label: string;
  short: string;
  badge: string | null;
  tone: string;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
  productCount: number;
};

export type AdminAmenityRow = {
  id: string;
  label: string;
  productCount: number;
};

export type AdminPromoCodeRow = {
  id: string;
  code: string;
  title: string;
  /** "fixed" | "percentage". */
  type: string;
  /** Fixed → USD cents. Percentage → 0-100. */
  value: number;
  minTotalUsdCents: number;
  usageLimit: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
};

export type AdminStats = {
  products: number;
  activeProducts: number;
  packages: number;
  serviceTypes: number;
  priceTiers: number;
  places: number;
  serviceLines: number;
  amenities: number;
  productAmenities: number;
  productAddOns: number;
};

export type AdminOption = {
  value: string;
  label: string;
};

export type AdminReferenceData = {
  lines: AdminOption[];
  serviceTypes: AdminOption[];
  places: AdminOption[];
  products: AdminOption[];
  amenities: AdminOption[];
  addOns: AdminOption[];
};

// ---------------------------------------------------------------------------
// Transactions (admin booking management)
// ---------------------------------------------------------------------------

/** The allowed Booking.status values. */
export type AdminBookingStatus =
  | "awaiting_payment"
  | "confirmed"
  | "cancelled"
  | "completed";

/** One booked line item — `quantity` is the number of rental days for per_day. */
export type AdminBookingItemRow = {
  label: string;
  packageLabel: string | null;
  /** "per_pax" | "per_unit" | "per_day". */
  unitKind: string;
  quantity: number;
  productId: string;
  productTitle: string | null;
  unitUsdCents: number;
  totalUsdCents: number;
};

/** A booking row of the transaction tables. Dates are ISO strings. */
export type AdminBookingRow = {
  id: string;
  code: string;
  status: AdminBookingStatus;
  serviceAt: string;
  createdAt: string;
  totalUsdCents: number;
  vehicleCount: number;
  customerName: string | null;
  customerEmail: string | null;
  items: AdminBookingItemRow[];
  /** The latest payment's status — null when no payment exists yet. */
  paymentStatus: string | null;
};

export type AdminBookingListResult = {
  rows: AdminBookingRow[];
  /** Total matching bookings (before pagination). */
  total: number;
  page: number;
  pageSize: number;
};

export type AdminBookingContact = {
  title: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phoneCountryCode: string;
  phone: string;
  nationality: string | null;
  /** "ktp" | "ssn" | "passport". */
  idType: string | null;
  identityNumber: string | null;
};

/** The latest payment of a booking. */
export type AdminBookingPayment = {
  /** "pending" | "paid" | "failed" | "refunded". */
  status: string;
  amountUsdCents: number;
  provider: string | null;
  reference: string | null;
  methodLabel: string | null;
  paidAt: string | null;
  createdAt: string;
};

/** The full booking detail shown in the transaction drawer. */
export type AdminBookingDetail = AdminBookingRow & {
  invoiceNumber: string | null;
  adultCount: number;
  childCount: number;
  infantCount: number;
  subtotalUsdCents: number;
  addOnsUsdCents: number;
  discountUsdCents: number;
  taxUsdCents: number;
  promoCode: string | null;
  pickupLabel: string | null;
  dropoffLabel: string | null;
  /** "with_driver" | "without_driver". */
  driverOption: string | null;
  /** "vendor_pickup" | "delivered". */
  pickupPolicy: string | null;
  notes: string | null;
  contact: AdminBookingContact | null;
  addOns: { label: string; quantity: number; totalUsdCents: number }[];
  payment: AdminBookingPayment | null;
  flight: {
    airline: string | null;
    flightCode: string | null;
    direction: string | null;
    airportName: string | null;
    location: string | null;
  } | null;
};

/** Per-status counters of one line scope, plus the completed revenue. */
export type AdminTransactionStats = {
  counts: Record<AdminBookingStatus, number>;
  /** All bookings in the scope, regardless of status. */
  total: number;
  /** Sum of totalUsdCents over completed bookings (USD cents). */
  completedTotalUsdCents: number;
};

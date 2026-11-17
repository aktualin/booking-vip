// Tour domain types — shared by the customer flow, the booking action and
// the admin area. The data helpers live in `src/lib/tour.ts`.

/** A tour tile of the static home-page data (`src/data/home.ts`). */
export type Tour = {
  slug: string;
  title: string;
  location: string;
  duration: string;
  rating: number;
  reviews: number;
  priceNet: number;
  priceFrom?: number;
  ribbon?: string;
  tone: string;
};

/** How a tour is sold: per vehicle (private) or per seat (join-in). */
export type TourKind = "private" | "join_in";

/** One stop of a tour day — `{ time: "08:00", activity: "Hotel pickup" }`. */
export type TourItineraryItem = {
  time: string;
  activity: string;
  /** Indonesian activity text — falls back to `activity` when absent. */
  activityId?: string;
};

/** One day of the day-by-day itinerary stored on `Product.itinerary`. */
export type TourItineraryDay = {
  day: number;
  title: string;
  /** Indonesian day title — falls back to `title` when absent. */
  titleId?: string;
  items: TourItineraryItem[];
};

/** A scheduled join-in departure with its derived seat availability. */
export type TourDepartureDTO = {
  id: string;
  productId: string;
  /** ISO date string of the departure day. */
  date: string;
  /** Local start time, "HH:MM". */
  startTime: string;
  quota: number;
  /** Seats reserved by active bookings (confirmed + unpaid within TTL). */
  reserved: number;
  /** `max(0, quota - reserved)` — 0 means sold out. */
  available: number;
  /** "open" | "closed" | "cancelled" */
  status: string;
  notes: string | null;
};

/** A driver / guide of the operator roster. */
export type TourDriverDTO = {
  id: string;
  name: string;
  phone: string;
  languages: string | null;
  photoUrl: string | null;
  notes: string | null;
  active: boolean;
  sortOrder: number;
};

/** A vehicle of the operator roster. */
export type TourVehicleDTO = {
  id: string;
  name: string;
  plateNumber: string | null;
  seats: number;
  photoUrl: string | null;
  notes: string | null;
  active: boolean;
  sortOrder: number;
};

/** The tour rules of a product, used to validate a booking server-side. */
export type TourProductRules = {
  productId: string;
  /** null when the product is not a tour. */
  tourKind: TourKind | null;
  minPax: number;
  maxPax: number | null;
  durationDays: number;
  leadTimeDays: number;
  leadTimeHours: number;
};

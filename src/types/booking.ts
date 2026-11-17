// Booking domain types.

export type CreateBookingInput = {
  productSlug: string;
  packageId?: string;
  serviceAt: string; // ISO datetime
  adult: number;
  child: number;
  infant: number;
  units?: number; // for per_unit packages (default 1)
  /** The number of rental days (for "per_day" packages). */
  days?: number;
  /**
   * How many units of the vehicle to reserve (transport "per_day" rentals).
   * Defaults to 1; forced to 1 for non-transport lines and per_pax/per_unit
   * packages. Validated against the available rental stock.
   */
  vehicleCount?: number;
  /**
   * The multi-car cart (transport rentals). When present and non-empty it
   * replaces the single-product fields (`productSlug`, `packageId`, `days`,
   * `units`, `vehicleCount`): ONE booking with one BookingItem per line, one
   * invoice and one payment. Every line must be a transport-line product
   * with an active "per_day" package; stock is checked per product over the
   * sum of the cart's lines for that product.
   */
  items?: {
    productSlug: string;
    packageId: string;
    /** Rental days of this line (default 1, validated 1..365). */
    days?: number;
    /** Units of this vehicle this line reserves (default 1, validated 1..99). */
    vehicleCount?: number;
  }[];
  /**
   * Client-generated key deduping booking creation — a retry with the same
   * key returns the original booking instead of creating a new one.
   * Trimmed and capped at 100 characters server-side.
   */
  idempotencyKey?: string;
  /** "vendor_pickup" | "delivered" — where the car is handed over. */
  pickupPolicy?: string;
  /** "with_driver" | "without_driver". */
  driverOption?: string;
  /** The free-form note of the customer (the "special request"). */
  notes?: string;
  addOns: { slug: string; qty: number }[];
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phoneCountryCode: string;
    phone: string;
    isGuestSelf: boolean;
    notes?: string;
    /** "mr" | "mrs" | "ms" */
    title?: string;
    /** Renter identity number (NIK / SSN / passport no.) — car rental. */
    identityNumber?: string;
    /** The identity document type: "ktp" | "ssn" | "passport". */
    idType?: string;
    /** Stored URL of the uploaded identity document (image/PDF) — car rental. */
    idDocumentUrl?: string;
    /** Stored URL of the renter's signature image (PNG) — car rental. */
    signatureUrl?: string;
    /** Country of origin name — airport VIP flow (Contact.nationality). */
    nationality?: string;
  };
  flight: {
    airportName?: string;
    location?: string;
    airline?: string;
    flightCode?: string;
    direction?: string;
  };
  /**
   * The passenger names.
   *
   * Optional: the transport flow only asks for the number of passengers, so
   * the names can be omitted — the booking is then stored without travellers.
   *
   * The passport fields are optional too — only the airport VIP flow collects
   * them. When provided they are validated server-side (expiry ≥ 6 months
   * after the service date, photo key must be a `passports/…` upload key).
   */
  travelers?: {
    fullName: string;
    kind: string;
    passportNumber?: string;
    /** Country of origin name (defaults to the contact nationality). */
    nationality?: string;
    /** ISO date string. */
    dateOfBirth?: string;
    /** ISO date string — must be ≥ 6 months after serviceAt. */
    passportExpiry?: string;
    /** PRIVATE R2 key of the uploaded passport photo — never a URL. */
    passportPhotoKey?: string;
  }[];
  /** The pickup point of a transport booking. */
  pickup?: {
    label: string;
    lat: number;
    lng: number;
  };
  /** The dropoff point of a transport booking. */
  dropoff?: {
    label: string;
    lat: number;
    lng: number;
  };
  /** The promo code the customer entered (optional). */
  promoCode?: string;
  /**
   * Tour join-in: the scheduled departure the booking seats on. Required
   * server-side when the product's `tourKind` is "join_in"; the seats are
   * validated against the departure quota.
   */
  departureId?: string;
  /** Tour: the hotel / pickup point name the customer typed (optional). */
  hotelName?: string;
};

/** One computed tax line — the client-safe mirror of `TaxLineDTO`. */
export type BookingTaxLine = {
  key: string;
  label: string;
  /** The raw configured value — "11%", "$1". */
  value: string;
  kind: "percentage" | "fixed";
  amount: number;
  amountUsdCents: number;
};

/** The tax preview of a subtotal (server-computed, read from `Setting`). */
export type TaxPreview = {
  lines: BookingTaxLine[];
  totalUsdCents: number;
};

export type CreateBookingResult =
  | {
      ok: true;
      code: string;
      totalUsdCents: number;
      invoiceNumber: string;
      /** The taxes included in `totalUsdCents`. */
      taxes: BookingTaxLine[];
      taxUsdCents: number;
    }
  | { ok: false; error: string };

export type BookingLookupDTO = {
  code: string;
  status: string;
  /**
   * The document-handling workflow of an airport VIP booking:
   * "waiting_documents" | "processing" | "ready" | "in_service" | "done".
   */
  opsStatus: string;
  /** The greeter assigned by ops (null until assigned). */
  greeterName: string | null;
  greeterPhone: string | null;
  serviceAt: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  subtotalUsd: number;
  addOnsUsd: number;
  totalUsd: number;
  items: {
    label: string;
    packageLabel?: string;
    unitKind: string;
    adultCount: number;
    childCount: number;
    infantCount: number;
    unitUsd: number;
    totalUsd: number;
  }[];
  addOns: {
    label: string;
    quantity: number;
    unitUsd: number;
    totalUsd: number;
  }[];
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phoneCountryCode: string;
    phone: string;
    /** Country of origin name (null for non-VIP bookings). */
    nationality: string | null;
  };
  travelers: {
    fullName: string;
    kind: string;
    passportNumber: string | null;
    nationality: string | null;
    /** ISO date string, or null when not collected. */
    dateOfBirth: string | null;
    /** ISO date string, or null when not collected. */
    passportExpiry: string | null;
    /** PRIVATE R2 key of the passport photo (null when not uploaded). */
    passportPhotoKey: string | null;
    /** "pending" | "received" | "processing" | "ready" | "issue". */
    docStatus: string;
  }[];
  createdAt: string;
};

export type BookingLookupResult =
  | { found: true; booking: BookingLookupDTO }
  | { found: false; reason: "not_found" | "error" };

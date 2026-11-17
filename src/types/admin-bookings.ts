// Admin transaction types — the tour-specific extension of the booking
// management DTOs in `./admin`. Kept in a separate module so the catalog
// types and the transaction types can evolve independently.

import type { AdminBookingDetail, AdminBookingRow } from "./admin";
import type { TourDepartureDTO, TourDriverDTO, TourVehicleDTO } from "./tour";

/** The service lines the transaction table can be scoped to. */
export const ADMIN_BOOKING_LINES = [
  { slug: "tour-package", label: "Tour Package" },
  { slug: "transport", label: "Transport" },
  { slug: "airport-vip", label: "Airport VIP" },
  { slug: "fast-track", label: "Fast Track" },
  { slug: "evoa", label: "eVOA" },
] as const;

/** Tour / operations fields added on top of the base booking row. */
export type AdminBookingTourExtras = {
  /** The service line of the first booked product — null when unknown. */
  lineSlug: string | null;
  lineLabel: string | null;
  adultCount: number;
  childCount: number;
  infantCount: number;
  /** Tour: the hotel / pickup point name the customer typed. */
  hotelName: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  /** "private" | "join_in" | null (non-tour products). */
  tourKind: string | null;
  /** The join-in departure with live seat availability — null when none. */
  departure: TourDepartureDTO | null;
  driver: TourDriverDTO | null;
  vehicle: TourVehicleDTO | null;
};

/** A list row with the line scope and the party size. */
export type AdminBookingRowFull = AdminBookingRow &
  Pick<
    AdminBookingTourExtras,
    "lineSlug" | "lineLabel" | "adultCount" | "childCount" | "infantCount"
  > & {
    driverName: string | null;
  };

/** The full detail incl. the tour operations panel. */
export type AdminBookingDetailFull = AdminBookingDetail & AdminBookingTourExtras;

/** The driver / vehicle pickers of the assignment panel. */
export type AssignmentOptions = {
  drivers: TourDriverDTO[];
  vehicles: TourVehicleDTO[];
};

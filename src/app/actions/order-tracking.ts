"use server";

import { db } from "@/prisma/db";
import { getUserSession } from "@/lib/user/session";
import { getBookingByCode } from "@/app/actions/booking";
import type { BookingLookupResult } from "@/types";

/**
 * Session-owned order tracking.
 *
 * The account area tracks an order by code alone — ownership is proven by
 * the session (Booking.userId), not by typing the contact email. Once
 * ownership is established the lookup delegates to `getBookingByCode`, so
 * the DTO mapping lives in exactly one place.
 */
export async function getMyOrderTracking(
  code: string
): Promise<BookingLookupResult> {
  const session = await getUserSession();
  if (!session) return { found: false, reason: "not_found" };

  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { found: false, reason: "not_found" };

  try {
    const bookings = await db.orm.public.Booking
      .select("id", "userId")
      .where((f) => f.code.eq(trimmed))
      .limit(1)
      .all();

    const booking = bookings[0];
    if (!booking || booking.userId !== session.uid) {
      return { found: false, reason: "not_found" };
    }

    const contacts = await db.orm.public.Contact
      .select("email")
      .where((f) => f.bookingId.eq(booking.id))
      .limit(1)
      .all();

    const contact = contacts[0];
    if (!contact) return { found: false, reason: "not_found" };

    return await getBookingByCode(trimmed, contact.email);
  } catch (error) {
    console.error("[order-tracking] lookup failed", error);
    return { found: false, reason: "error" };
  }
}

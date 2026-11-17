import "server-only";

import { db } from "@/prisma/db";
import { generateInvoiceNumber } from "@/lib/invoice";
import type { EvoaQuote } from "@/lib/evoa-pricing";

/**
 * e-VOA booking bridge.
 *
 * An e-VOA order is paid through the SAME pipeline as every other booking:
 * one `Booking` (status "awaiting_payment") with a placeholder `Payment` row,
 * settled by `startPayment` → Xendit. This module only prepares that booking
 * and links it back to the `VisaApplication`; the webhook/refresh hook in
 * `payments.ts` flips the visa order to "paid" once the money lands.
 *
 * The insert conventions (unique code, unique invoice, sequential writes with
 * compensating deletes, idempotency-key dedupe) mirror `createBooking` in
 * `src/app/actions/booking.ts` so both flows behave identically.
 */

export type CreateEvoaBookingResult =
  | { ok: true; bookingId: string; bookingCode: string }
  | { ok: false; error: string };

/** The generic failure message — any create problem surfaces this to the user. */
const PREPARE_FAILED = "Pembayaran tidak bisa disiapkan. Coba lagi.";

/* ------------------------------------------------------------------ */
/* Code / invoice generation — copies of the booking.ts patterns       */
/* ------------------------------------------------------------------ */

/** Generate a BV- code with 6 chars from an unambiguous alphabet. */
function generateBookingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/1/I/O
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i]! % alphabet.length];
  }
  return "BV-" + code;
}

/** Check if a booking code exists. */
async function codeExists(code: string): Promise<boolean> {
  const existing = await db.orm.public.Booking
    .select("id")
    .where((f) => f.code.eq(code))
    .limit(1)
    .all();
  return existing.length > 0;
}

/** Generate a unique booking code with up to 3 retries. */
async function generateUniqueCode(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateBookingCode();
    const exists = await codeExists(code);
    if (!exists) return code;
  }
  return null;
}

/** Generate an invoice number that is not taken yet (up to 5 retries). */
async function generateUniqueInvoiceNumber(): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = generateInvoiceNumber();
    const existing = await db.orm.public.Booking
      .select("id")
      .where((f) => f.invoiceNumber.eq(number))
      .limit(1)
      .all();
    if (existing.length === 0) return number;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Contact normalization                                               */
/* ------------------------------------------------------------------ */

/**
 * Known ITU country calling codes (digits only). Used to peel the dial prefix
 * off an E.164 number. Real codes are prefix-free, so a greedy longest match
 * is unambiguous.
 */
const DIAL_CODES = new Set<string>([
  "1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41",
  "43", "44", "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56",
  "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86",
  "90", "91", "92", "93", "94", "95", "98",
  "212", "213", "216", "218", "220", "221", "222", "223", "224", "225", "226",
  "227", "228", "229", "230", "231", "232", "233", "234", "235", "236", "237",
  "238", "239", "240", "241", "242", "243", "244", "245", "246", "248", "249",
  "250", "251", "252", "253", "254", "255", "256", "257", "258", "260", "261",
  "262", "263", "264", "265", "266", "267", "268", "269", "290", "291", "297",
  "298", "299", "350", "351", "352", "353", "354", "355", "356", "357", "358",
  "359", "370", "371", "372", "373", "374", "375", "376", "377", "378", "380",
  "381", "382", "385", "386", "387", "389", "420", "421", "423", "500", "501",
  "502", "503", "504", "505", "506", "507", "508", "509", "590", "591", "592",
  "593", "594", "595", "596", "597", "598", "599", "670", "672", "673", "674",
  "675", "676", "677", "678", "679", "680", "681", "682", "683", "685", "686",
  "687", "688", "689", "690", "691", "692", "850", "852", "853", "855", "856",
  "880", "886", "960", "961", "962", "963", "964", "965", "966", "967", "968",
  "970", "971", "972", "973", "974", "975", "976", "977", "992", "993", "994",
  "995", "996", "998",
]);

/**
 * Split a raw phone string into a dial prefix + local digits.
 *
 * A leading "+" means the caller already gave an international number: peel
 * the longest known dial prefix (up to 4 digits) and keep the rest. Without a
 * "+" we assume an Indonesian local number (default +62) and drop the trunk
 * "0", matching how `e164Phone` in payments.ts reassembles it later.
 */
function splitPhone(raw: string): { phoneCountryCode: string; phone: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    // Greedy longest match — country codes are prefix-free, so this is safe.
    for (let len = 4; len >= 1; len--) {
      const candidate = digits.slice(0, len);
      if (DIAL_CODES.has(candidate)) {
        return { phoneCountryCode: "+" + candidate, phone: digits.slice(len) };
      }
    }
    // No known prefix — fall back to +62 and keep the digits as the number.
    return { phoneCountryCode: "+62", phone: digits };
  }

  let local = trimmed.replace(/\D/g, "");
  if (local.startsWith("0")) local = local.slice(1);
  return { phoneCountryCode: "+62", phone: local };
}

/** Split a full name into first/last. A single word becomes both. */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: "", lastName: "" };
  if (words.length === 1) return { firstName: words[0]!, lastName: words[0]! };
  return {
    firstName: words.slice(0, -1).join(" "),
    lastName: words[words.length - 1]!,
  };
}

/* ------------------------------------------------------------------ */
/* Booking creation                                                    */
/* ------------------------------------------------------------------ */

/** Link the visa order to a booking and snapshot the charged total. */
async function linkApplication(
  applicationId: string,
  bookingId: string,
  totalUsdCents: number,
): Promise<void> {
  await db.orm.public.VisaApplication
    .where((f) => f.id.eq(applicationId))
    .update({ bookingId, totalUsdCents });
}

/**
 * Prepare (or reuse) the booking that pays for an e-VOA order.
 *
 * Idempotent on two axes: an application already linked to a booking returns
 * that booking, and a retry carrying the same client idempotency key returns
 * the original booking. Only when neither hits do we insert new rows.
 */
export async function createEvoaBooking(params: {
  applicationId: string;
  applicationCode: string;
  userId: string | null;
  contactName: string;
  email: string;
  phone: string;
  arrivalDate: Date;
  applicantNames: string[];
  quote: EvoaQuote;
  idempotencyKey?: string;
}): Promise<CreateEvoaBookingResult> {
  try {
    const {
      applicationId,
      userId,
      contactName,
      email,
      phone,
      arrivalDate,
      applicantNames,
      quote,
    } = params;

    // The order must exist before we can attach a payment to it.
    const applications = await db.orm.public.VisaApplication
      .select("id", "bookingId")
      .where((f) => f.id.eq(applicationId))
      .limit(1)
      .all();
    const application = applications[0];
    if (!application) {
      return { ok: false, error: "Aplikasi e-VOA tidak ditemukan." };
    }

    // Already linked — return the existing booking without writing anything.
    if (application.bookingId) {
      const linked = await db.orm.public.Booking
        .select("id", "code")
        .where((f) => f.id.eq(application.bookingId!))
        .limit(1)
        .all();
      const booking = linked[0];
      if (booking) {
        return { ok: true, bookingId: booking.id, bookingCode: booking.code };
      }
      // A dangling link (booking removed) falls through and is re-created.
    }

    // Idempotency — a retry with the same client key reuses the original
    // booking. Mirror createBooking's key normalization.
    const idempotencyKey =
      typeof params.idempotencyKey === "string"
        ? params.idempotencyKey.trim().slice(0, 100)
        : "";
    if (idempotencyKey) {
      const prior = await db.orm.public.Booking
        .select("id", "code", "totalUsdCents")
        .where((f) => f.idempotencyKey.eq(idempotencyKey))
        .limit(1)
        .all();
      const booking = prior[0];
      if (booking) {
        // Keep the order total in sync with what the booking actually charges.
        await linkApplication(applicationId, booking.id, booking.totalUsdCents);
        return { ok: true, bookingId: booking.id, bookingCode: booking.code };
      }
    }

    // Resolve the two catalog lines by slug. No `active` filter: the official
    // fee line is deliberately inactive (hidden from the catalog) but must
    // still be bookable as an invoice line.
    const products = await db.orm.public.Product
      .select("id", "slug")
      .where((f) => f.slug.in(["evoa-b1", "evoa-official-fee"]))
      .all();
    const serviceProduct = products.find((p) => p.slug === "evoa-b1");
    const feeProduct = products.find((p) => p.slug === "evoa-official-fee");
    if (!serviceProduct || !feeProduct) {
      console.error("[evoa-booking] missing e-VOA catalog products", {
        service: !!serviceProduct,
        fee: !!feeProduct,
      });
      return { ok: false, error: "Produk e-VOA belum tersedia. Coba lagi." };
    }

    const code = await generateUniqueCode();
    if (!code) return { ok: false, error: PREPARE_FAILED };
    const invoiceNumber = await generateUniqueInvoiceNumber();
    if (!invoiceNumber) return { ok: false, error: PREPARE_FAILED };

    const n = applicantNames.length;
    const bookingId = crypto.randomUUID();
    const { firstName, lastName } = splitName(contactName);
    const { phoneCountryCode, phone: localPhone } = splitPhone(phone);

    // Sequential inserts with compensating deletes on failure — same shape as
    // createBooking, so a half-written order never lingers.
    try {
      // 1. Booking
      try {
        await db.orm.public.Booking.create({
          id: bookingId,
          code,
          status: "awaiting_payment",
          serviceAt: arrivalDate,
          adultCount: n,
          childCount: 0,
          infantCount: 0,
          subtotalUsdCents: quote.totalUsdCents,
          addOnsUsdCents: 0,
          totalUsdCents: quote.totalUsdCents,
          userId,
          invoiceNumber,
          idempotencyKey: idempotencyKey || null,
          promoCode: null,
          discountUsdCents: 0,
          taxes: [] as never,
          taxUsdCents: 0,
          notes: null,
        });
      } catch (bookingError) {
        // A concurrent request with the same idempotency key won the insert
        // race — link and return its booking instead of a duplicate.
        if (idempotencyKey) {
          const prior = await db.orm.public.Booking
            .select("id", "code", "totalUsdCents")
            .where((f) => f.idempotencyKey.eq(idempotencyKey))
            .limit(1)
            .all();
          const winner = prior[0];
          if (winner) {
            await linkApplication(applicationId, winner.id, winner.totalUsdCents);
            return { ok: true, bookingId: winner.id, bookingCode: winner.code };
          }
        }
        throw bookingError;
      }

      // 2. BookingItems — our service fee + the official immigration fee.
      await db.orm.public.BookingItem.create({
        id: crypto.randomUUID(),
        bookingId,
        productId: serviceProduct.id,
        label: "e-VOA B1 — jasa pengurusan",
        unitKind: "per_pax",
        adultCount: n,
        childCount: 0,
        infantCount: 0,
        quantity: n,
        unitUsdCents: quote.serviceFeeUsdCents,
        totalUsdCents: quote.serviceFeeUsdCents * n,
      });
      await db.orm.public.BookingItem.create({
        id: crypto.randomUUID(),
        bookingId,
        productId: feeProduct.id,
        label: "Biaya resmi e-VOA (Imigrasi)",
        unitKind: "per_pax",
        adultCount: n,
        childCount: 0,
        infantCount: 0,
        quantity: n,
        unitUsdCents: quote.officialFeeUsdCents,
        totalUsdCents: quote.officialFeeUsdCents * n,
      });

      // 3. Contact — the pemesan (normalize email like createBooking does).
      await db.orm.public.Contact.create({
        id: crypto.randomUUID(),
        bookingId,
        firstName,
        lastName,
        email: email.trim().toLowerCase(),
        phoneCountryCode,
        phone: localPhone,
        isGuestSelf: false,
        notes: null,
      });

      // 4. Travelers — one per applicant, all adults.
      for (let i = 0; i < applicantNames.length; i++) {
        await db.orm.public.Traveler.create({
          id: crypto.randomUUID(),
          bookingId,
          fullName: applicantNames[i]!.trim(),
          kind: "adult",
          sortOrder: i,
        });
      }

      // 5. Placeholder Payment — startPayment fills it with the gateway data.
      await db.orm.public.Payment.create({
        id: crypto.randomUUID(),
        bookingId,
        methodId: null,
        status: "pending",
        amountUsdCents: quote.totalUsdCents,
      });

      // 6. Link the order last, so a failure above leaves it unattached.
      await linkApplication(applicationId, bookingId, quote.totalUsdCents);

      return { ok: true, bookingId, bookingCode: code };
    } catch (insertError) {
      // Compensating deletes — never touch the pre-existing VisaApplication.
      console.error("[evoa-booking] insert failed, rolling back", insertError);
      try {
        await db.orm.public.Payment.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.Traveler.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.Contact.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.BookingItem.where((f) => f.bookingId.eq(bookingId)).deleteAll();
        await db.orm.public.Booking.where((f) => f.id.eq(bookingId)).deleteAll();
      } catch (rollbackError) {
        console.error("[evoa-booking] rollback failed", rollbackError);
      }
      return { ok: false, error: PREPARE_FAILED };
    }
  } catch (error) {
    console.error("[evoa-booking] could not prepare the booking", error);
    return { ok: false, error: PREPARE_FAILED };
  }
}
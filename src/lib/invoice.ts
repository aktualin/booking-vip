import "server-only";

import { db } from "@/prisma/db";

/**
 * Invoice numbers.
 *
 * The format is fixed:
 *
 *   #INV/TAHUN/BULAN/TANGGAL/4DIGIT/2RANDOM STRING
 *
 *   #INV/2026/11/12/4821/KQ
 *
 * `TAHUN/BULAN/TANGGAL` is the booking date, the four digits and the two
 * letters are random — together they make the number unique.
 */

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O, Q-like confusions
const DIGITS = "0123456789";

/** Random characters out of an alphabet. */
function randomFrom(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/**
 * Build an invoice number for a date.
 *
 * `date` defaults to now; the parts are zero-padded (`11`, not `1`).
 */
export function generateInvoiceNumber(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const block = randomFrom(DIGITS, 4);
  const suffix = randomFrom(LETTERS, 2);

  return `#INV/${year}/${month}/${day}/${block}/${suffix}`;
}

/**
 * A human readable application number (e-VOA).
 *
 * `EVA/YYYY/MM/DD/4DIGIT/2RANDOM` — the same shape as the invoice number.
 */
export function generateApplicationCode(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const block = randomFrom(DIGITS, 4);
  const suffix = randomFrom(LETTERS, 2);

  return `EVA/${year}/${month}/${day}/${block}/${suffix}`;
}

/** The URL of the printable invoice of a booking. */
export function invoicePath(code: string): string {
  return `/account/orders/${encodeURIComponent(code)}/invoice`;
}

// ---------------------------------------------------------------------------
// Invoice data
// ---------------------------------------------------------------------------

export type InvoiceDTO = {
  code: string;
  invoiceNumber: string | null;
  status: string;
  serviceAt: string;
  createdAt: string;
  currencyCode: string;
  fxRate: number;
  subtotalUsdCents: number;
  addOnsUsdCents: number;
  discountUsdCents: number;
  taxUsdCents: number;
  totalUsdCents: number;
  promoCode: string | null;
  pickupLabel: string | null;
  dropoffLabel: string | null;
  pickupPolicy: string | null;
  driverOption: string | null;
  notes: string | null;
  taxes: { key: string; label: string; value: string; amountUsdCents: number }[];
  items: {
    label: string;
    packageLabel: string | null;
    unitKind: string;
    quantity: number;
    adultCount: number;
    childCount: number;
    infantCount: number;
    unitUsdCents: number;
    totalUsdCents: number;
  }[];
  addOns: { label: string; quantity: number; unitUsdCents: number; totalUsdCents: number }[];
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phoneCountryCode: string;
    phone: string;
  } | null;
  travelers: { fullName: string; kind: string }[];
  payment: {
    status: string;
    methodLabel: string | null;
    provider: string | null;
    providerRef: string | null;
    providerAmountCents: number | null;
    providerCurrency: string | null;
    fxRate: number | null;
    paidAt: string | null;
  } | null;
};

/** Read the tax lines stored on a booking. */
export function parseTaxLines(value: unknown): { key: string; label: string; value: string; amountUsdCents: number }[] {
  if (!Array.isArray(value)) return [];
  const lines: { key: string; label: string; value: string; amountUsdCents: number }[] = [];
  for (const item of value) {
    const line = item as {
      key?: string;
      label?: string;
      value?: string;
      amountUsdCents?: number;
    };
    if (!line?.key) continue;
    lines.push({
      key: line.key,
      label: line.label ?? line.key,
      value: line.value ?? "",
      amountUsdCents: line.amountUsdCents ?? 0,
    });
  }
  return lines;
}

/** The full invoice DTO of a booking, loaded by its id. */
export async function loadInvoice(bookingId: string): Promise<InvoiceDTO | null> {
  const rows = await db.orm.public.Booking
    .select(
      "id",
      "code",
      "invoiceNumber",
      "status",
      "serviceAt",
      "createdAt",
      "currencyCode",
      "fxRate",
      "subtotalUsdCents",
      "addOnsUsdCents",
      "discountUsdCents",
      "taxUsdCents",
      "totalUsdCents",
      "promoCode",
      "taxes",
      "pickupLabel",
      "dropoffLabel",
      "pickupPolicy",
      "driverOption",
      "notes",
    )
    .where((f) => f.id.eq(bookingId))
    .limit(1)
    .all();

  const booking = rows[0];
  if (!booking) return null;

  const [items, addOns, contacts, travelers, payments] = await Promise.all([
    db.orm.public.BookingItem
      .select(
        "label",
        "packageLabel",
        "unitKind",
        "quantity",
        "adultCount",
        "childCount",
        "infantCount",
        "unitUsdCents",
        "totalUsdCents",
      )
      .where((f) => f.bookingId.eq(booking.id))
      .all(),
    db.orm.public.BookingAddOn
      .select("label", "quantity", "unitUsdCents", "totalUsdCents")
      .where((f) => f.bookingId.eq(booking.id))
      .all(),
    db.orm.public.Contact
      .select("firstName", "lastName", "email", "phoneCountryCode", "phone")
      .where((f) => f.bookingId.eq(booking.id))
      .limit(1)
      .all(),
    db.orm.public.Traveler
      .select("fullName", "kind")
      .where((f) => f.bookingId.eq(booking.id))
      .all(),
    db.orm.public.Payment
      .select(
        "id",
        "status",
        "provider",
        "providerRef",
        "providerAmountCents",
        "providerCurrency",
        "fxRate",
        "paidAt",
        "methodId",
      )
      .where((f) => f.bookingId.eq(booking.id))
      .orderBy((f) => f.createdAt.desc())
      .all(),
  ]);

  const contact = contacts[0] ?? null;

  // The newest payment that actually reached a gateway — the provider-less
  // placeholder created with the booking is skipped.
  const settled =
    payments.find((row) => row.provider != null && row.providerRef != null) ?? null;

  const methodId = settled?.methodId ?? null;
  let methodLabel: string | null = null;
  if (methodId) {
    const methods = await db.orm.public.PaymentMethod
      .select("label")
      .where((f) => f.id.eq(methodId))
      .limit(1)
      .all();
    methodLabel = methods[0]?.label ?? null;
  }

  return {
    code: booking.code,
    invoiceNumber: booking.invoiceNumber ?? null,
    status: booking.status,
    serviceAt: new Date(booking.serviceAt).toISOString(),
    createdAt: new Date(booking.createdAt).toISOString(),
    currencyCode: booking.currencyCode,
    fxRate: booking.fxRate,
    subtotalUsdCents: booking.subtotalUsdCents,
    addOnsUsdCents: booking.addOnsUsdCents,
    discountUsdCents: booking.discountUsdCents,
    taxUsdCents: booking.taxUsdCents,
    totalUsdCents: booking.totalUsdCents,
    promoCode: booking.promoCode ?? null,
    pickupLabel: booking.pickupLabel ?? null,
    dropoffLabel: booking.dropoffLabel ?? null,
    pickupPolicy: booking.pickupPolicy ?? null,
    driverOption: booking.driverOption ?? null,
    notes: booking.notes ?? null,
    taxes: parseTaxLines(booking.taxes),
    items: items.map((item) => ({
      label: item.label,
      packageLabel: item.packageLabel ?? null,
      unitKind: item.unitKind,
      quantity: item.quantity,
      adultCount: item.adultCount,
      childCount: item.childCount,
      infantCount: item.infantCount,
      unitUsdCents: item.unitUsdCents,
      totalUsdCents: item.totalUsdCents,
    })),
    addOns: addOns.map((addOn) => ({
      label: addOn.label,
      quantity: addOn.quantity,
      unitUsdCents: addOn.unitUsdCents,
      totalUsdCents: addOn.totalUsdCents,
    })),
    contact: contact
      ? {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phoneCountryCode: contact.phoneCountryCode,
          phone: contact.phone,
        }
      : null,
    travelers: travelers.map((traveler) => ({
      fullName: traveler.fullName,
      kind: traveler.kind,
    })),
    payment: settled
      ? {
          status: settled.status,
          methodLabel,
          provider: settled.provider ?? null,
          providerRef: settled.providerRef ?? null,
          providerAmountCents: settled.providerAmountCents ?? null,
          providerCurrency: settled.providerCurrency ?? null,
          fxRate: settled.fxRate ?? null,
          paidAt: settled.paidAt ? new Date(settled.paidAt).toISOString() : null,
        }
      : null,
  };
}

/**
 * The invoice of a guest booking.
 *
 * Ownership is proven by the booking code plus the contact email — the same
 * rule as `getBookingByCode` / `startPayment`. Any miss returns null.
 */
export async function getInvoiceByCodeAndEmail(
  code: string,
  email: string,
): Promise<InvoiceDTO | null> {
  const normalizedCode = code.trim().toUpperCase();
  const normalizedEmail = email.trim().toLowerCase();

  const bookings = await db.orm.public.Booking
    .select("id")
    .where((f) => f.code.eq(normalizedCode))
    .limit(1)
    .all();

  const booking = bookings[0];
  if (!booking) return null;

  const contacts = await db.orm.public.Contact
    .select("email")
    .where((f) => f.bookingId.eq(booking.id))
    .limit(1)
    .all();

  const contact = contacts[0];
  // Case-insensitive + whitespace-tolerant comparison on both sides.
  if (!contact || contact.email.trim().toLowerCase() !== normalizedEmail) {
    return null;
  }

  return loadInvoice(booking.id);
}

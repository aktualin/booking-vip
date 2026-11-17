// PayPal E2E — step 1: start a real payment for an awaiting_payment booking
// through the SAME startPayment() code path the server action uses, and print
// the sandbox approve URL for the payer.
// Run: node --experimental-strip-types --import ./scripts/tmp/alias-loader.mts scripts/tmp/paypal-e2e-start.mts
import "dotenv/config";
import { startPayment } from "@/lib/payments";
import { db } from "@/prisma/db";

const BOOKING_CODE = process.argv[2] ?? "BV-5CGR2H";

try {
  const bookings = await db.orm.public.Booking
    .select("id", "code")
    .where((f) => f.code.eq(BOOKING_CODE))
    .limit(1)
    .all();
  const booking = bookings[0];
  if (!booking) throw new Error(`booking ${BOOKING_CODE} not found`);

  const contacts = await db.orm.public.Contact
    .select("email")
    .where((f) => f.bookingId.eq(booking.id))
    .limit(1)
    .all();
  const email = contacts[0]?.email;
  if (!email) throw new Error("booking has no contact email");

  const result = await startPayment({
    bookingCode: BOOKING_CODE,
    email,
    methodCode: "PAYPAL",
  });

  console.log("startPayment result:");
  console.log(JSON.stringify(result, null, 2));

  if (result.ok) {
    const pays = await db.orm.public.Payment
      .select("id", "status", "provider", "providerRef", "providerAmountCents", "providerCurrency", "fxRate", "reference", "checkoutUrl", "expiresAt")
      .where((f) => f.id.eq(result.paymentId))
      .limit(1)
      .all();
    console.log("payment row:");
    console.log(JSON.stringify(pays[0], null, 2));
  }
} catch (error) {
  console.error("E2E start FAILED:", error);
  process.exitCode = 1;
} finally {
  await db.close();
}

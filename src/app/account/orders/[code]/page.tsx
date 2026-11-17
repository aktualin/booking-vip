import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getUserSession } from "@/lib/user/session";
import { getMyOrderTracking } from "@/app/actions/order-tracking";
import { db } from "@/prisma/db";
import VipTracking from "@/components/booking/VipTracking";
import OrderActionLinks from "@/components/account/OrderActionLinks";
import {
  BackToOrdersLink,
  NotFoundNotice,
  OrderSummaryCard,
  OrdersLoadingText,
  SessionInvalidNotice,
} from "@/components/account/OrderTrackingParts";

export const metadata: Metadata = {
  title: "Lacak Pesanan · Booking VIP",
  description: "Lacak status pengurusan dokumen dan layanan Airport VIP.",
};

/**
 * The tracking page of one order in the account area.
 *
 * Ownership is proven by the session (see `getMyOrderTracking`). The page
 * shows a compact summary plus the VIP document-handling timeline; for
 * non-VIP orders the timeline renders nothing and the summary stands alone.
 *
 * The dynamic part (the session read plus the order lookup) is isolated
 * behind its own Suspense boundary with `await connection()` — the
 * cacheComponents pattern used across the app (see the e-VOA tracking page).
 */
export default function OrderTrackingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <BackToOrdersLink />
      </div>

      <Suspense fallback={<OrdersLoadingText />}>
        <TrackingSection params={params} />
      </Suspense>
    </div>
  );
}

/** The session check and the order lookup — dynamic, streamed in. */
async function TrackingSection({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();

  const { code } = await params;
  const session = await getUserSession();

  if (!session) {
    return <SessionInvalidNotice body="track" />;
  }

  const result = await getMyOrderTracking(code);

  if (!result.found) {
    return <NotFoundNotice kind="order" />;
  }

  const booking = result.booking;

  // Extra entry points: the checkout retry of an unpaid order and the
  // signed rental agreement of a transport order.
  const bookingRows = await db.orm.public.Booking
    .select("id", "status")
    .where((f) => f.code.eq(booking.code))
    .limit(1)
    .all();
  const bookingRow = bookingRows[0];
  const contracts = bookingRow
    ? await db.orm.public.SignedContract.select("id")
        .where((f) => f.bookingId.eq(bookingRow.id))
        .limit(1)
        .all()
    : [];

  return (
    <>
      <OrderSummaryCard
        code={booking.code}
        serviceAt={booking.serviceAt}
        totalUsd={booking.totalUsd}
      />

      {bookingRow?.status === "awaiting_payment" || contracts.length > 0 ? (
        <OrderActionLinks
          code={booking.code}
          showPay={bookingRow?.status === "awaiting_payment"}
          showAgreement={contracts.length > 0}
        />
      ) : null}

      <VipTracking booking={booking} />
    </>
  );
}

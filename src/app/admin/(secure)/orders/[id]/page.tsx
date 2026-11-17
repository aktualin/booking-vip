import { Suspense } from "react";
import type { Metadata } from "next";
import OrderDetailManager from "./OrderDetailManager";

export const metadata: Metadata = {
  title: "Detail Order · Admin",
  robots: { index: false, follow: false },
};

/**
 * The detail page of one Airport VIP order.
 *
 * The record id comes from the URL, so it is read inside a `<Suspense>`
 * boundary: with Cache Components enabled a URL read outside a boundary
 * blocks the instant navigation shell. The data itself loads client-side
 * through `getOrderDetail`, never during prerender.
 */
export default function AdminOrderDetailPage(
  props: PageProps<"/admin/orders/[id]">
) {
  return (
    <Suspense fallback={<AdminOrderDetailFallback />}>
      <AdminOrderDetailLoader {...props} />
    </Suspense>
  );
}

/** Reads the id and renders the manager. */
async function AdminOrderDetailLoader(
  props: PageProps<"/admin/orders/[id]">
) {
  const { id } = await props.params;
  return <OrderDetailManager bookingId={id} />;
}

/** Shown while the id is being resolved. */
function AdminOrderDetailFallback() {
  return (
    <div className="rounded-lg border border-[var(--admin-line)] px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]">
      Memuat data…
    </div>
  );
}
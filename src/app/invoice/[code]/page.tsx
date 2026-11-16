import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import GuestInvoiceClient from "@/components/invoice/GuestInvoiceClient";

export const metadata: Metadata = {
  title: "Invoice · Booking VIP",
  description: "Invoice Booking VIP.",
  robots: { index: false, follow: false },
};

/**
 * The public invoice page — no login required.
 *
 * Guests prove ownership with the booking code plus the contact email (taken
 * from the browser when it matches, otherwise asked for), the same rule the
 * payment flow uses.
 */
export default function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <InvoiceStep params={params} />
    </Suspense>
  );
}

/** The dynamic part: the booking code from the path. */
async function InvoiceStep({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();

  const { code } = await params;

  return <GuestInvoiceClient code={code} />;
}
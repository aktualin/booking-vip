import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getBranding } from "@/lib/branding";
import { BackToOrdersLink } from "@/components/account/OrderTrackingParts";
import AgreementClient from "@/components/account/AgreementClient";

export const metadata: Metadata = {
  title: "Perjanjian Sewa · Booking VIP",
  robots: { index: false, follow: false },
};

/**
 * The signed rental agreement of one booking — the frozen articles, the
 * signer name and the signature image, printable like the invoice.
 */
export default function AgreementPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 print:hidden">
        <BackToOrdersLink />
      </div>
      <Suspense fallback={null}>
        <AgreementSection params={params} />
      </Suspense>
    </div>
  );
}

async function AgreementSection({ params }: { params: Promise<{ code: string }> }) {
  await connection();

  const { code } = await params;
  const brand = await getBranding();

  return <AgreementClient code={code.toUpperCase()} brand={brand} />;
}

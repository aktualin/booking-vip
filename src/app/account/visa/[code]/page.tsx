import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import EvoaTrackingPanel from "@/components/account/evoa/EvoaTrackingPanel";
import {
  VisaLoadingText,
  VisaNotFoundNotice,
  VisaTrackingHeader,
} from "@/components/account/evoa/VisaTrackingParts";
import { getEvoaTracking } from "@/app/actions/evoa-tracking";

export const metadata: Metadata = {
  title: "Lacak e-VOA · Booking VIP",
  description: "Pantau status pengajuan e-VOA kamu — dokumen, revisi, dan visa terbit.",
};

/**
 * The customer's e-VOA tracking page.
 *
 * Lives inside the account area, so the layout already provides the site
 * header / footer, the container and the signed-in gate. The dynamic part
 * (the order lookup, which reads the session cookie) is isolated behind its
 * own Suspense boundary with `await connection()` — the cacheComponents
 * pattern used across the app. The visible copy lives in client components
 * (see `VisaTrackingParts`) so it follows the active language.
 */
export default function VisaTrackingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <div>
      <VisaTrackingHeader />

      <Suspense fallback={<VisaLoadingText />}>
        <TrackingSection params={params} />
      </Suspense>
    </div>
  );
}

/** The order lookup — null when the code is unknown or not owned. */
async function TrackingSection({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await connection();

  const { code } = await params;
  const tracking = await getEvoaTracking(code);

  if (!tracking) {
    return <VisaNotFoundNotice />;
  }

  return <EvoaTrackingPanel tracking={tracking} />;
}

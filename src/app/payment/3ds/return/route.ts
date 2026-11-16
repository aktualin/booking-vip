import { NextResponse } from "next/server";
import { completeCardDirectPayment } from "@/lib/payments";

/**
 * The 3DS return endpoint (Host-to-Host card flow).
 *
 * DOKU redirects the customer here after the issuer's 3DS authentication —
 * `?state=failed` when it failed or was cancelled. The charge happens on the
 * server (with the vaulted CVV), then the browser lands on the regular
 * payment return page that polls the status.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();
  const paymentId = url.searchParams.get("pid")?.trim();
  const failed = url.searchParams.get("state") === "failed";

  const target = (status: string) =>
    new URL(
      `/payment/return?code=${encodeURIComponent(code ?? "")}${status}`,
      url.origin,
    );

  if (!code || !paymentId) {
    return NextResponse.redirect(target("&status=failed&reason=missing-params"));
  }

  try {
    const result = await completeCardDirectPayment(paymentId, failed);
    if (result.paid) {
      return NextResponse.redirect(target(""));
    }
    const reason = failed ? "3ds-cancelled" : (result.error ?? "unknown");
    return NextResponse.redirect(
      target(`&status=failed&reason=${encodeURIComponent(reason)}`),
    );
  } catch (error) {
    console.error("[3ds-return] could not complete the payment", error);
    return NextResponse.redirect(target("&status=failed&reason=error"));
  }
}
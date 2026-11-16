// Temporary verification: switch PaymentMethod rows to DOKU, then exercise
// the sandbox APIs (card payment page + QRIS checkout + check status).
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/verify-doku.mts
import "dotenv/config";
import { db } from "../../src/prisma/db.ts";
import {
  createCardPaymentPage,
  createQrisCheckout,
  checkStatus,
} from "../../src/lib/doku.ts";

// 1. Payment methods — DOKU for CC + QRIS, the rest inactive.
const methods = await db.orm.public.PaymentMethod
  .select("id", "code", "provider", "active")
  .all();

for (const m of methods) {
  const live = m.code === "CREDIT_CARD" || m.code === "QRIS";
  await db.orm.public.PaymentMethod.where({ id: m.id }).update({
    provider: live ? "doku" : null,
    providerMethodCode: live ? m.code : null,
    providerCurrency: live ? "IDR" : null,
    active: live,
  });
  console.log(`method ${m.code}: provider=${live ? "doku" : "null"} active=${live}`);
}

const stamp = Date.now();
const input = {
  amountIdr: 10000,
  payerEmail: "sandbox-test@example.com",
  payerName: "Sandbox Test",
  description: "DOKU sandbox verification",
  successRedirectUrl: "https://42b2dbb6841bf6.app.lhr.life/payment/return?code=TEST",
  failureRedirectUrl: "https://42b2dbb6841bf6.app.lhr.life/payment/return?code=TEST&status=failed",
};

// 2. Card payment page.
const ccInvoice = `TEST-CC-${stamp}`.slice(0, 30);
try {
  const cc = await createCardPaymentPage({ ...input, invoiceNumber: ccInvoice });
  console.log("\nCARD OK", ccInvoice);
  console.log("url:", cc.checkoutUrl);
  console.log("expires:", cc.expiresAt?.toISOString());
} catch (e) {
  console.error("\nCARD FAILED:", (e as Error).message);
}

// 3. QRIS checkout.
const qrInvoice = `TEST-QRIS-${stamp}`.slice(0, 30);
try {
  const qr = await createQrisCheckout({ ...input, invoiceNumber: qrInvoice });
  console.log("\nQRIS OK", qrInvoice);
  console.log("url:", qr.checkoutUrl);
  console.log("expires:", qr.expiresAt?.toISOString());
} catch (e) {
  console.error("\nQRIS FAILED:", (e as Error).message);
}

// 4. Check status of the card invoice (expect PENDING / not-found).
try {
  const st = await checkStatus(ccInvoice);
  console.log("\nCHECK STATUS:", JSON.stringify(st.transaction ?? st));
} catch (e) {
  console.error("\nCHECK STATUS FAILED:", (e as Error).message);
}

process.exit(0);
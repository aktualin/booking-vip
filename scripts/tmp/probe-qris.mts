import "dotenv/config";
import { createQrisCheckout } from "../../src/lib/doku.ts";
try {
  const res = await createQrisCheckout({
    invoiceNumber: "PROBE-QRIS-" + Date.now(),
    amountIdr: 10000,
    payerEmail: "probe-qris@example.com",
    description: "QRIS probe",
    successRedirectUrl: "https://0197730e87daee.app.lhr.life/payment/return?code=TEST",
    failureRedirectUrl: "https://0197730e87daee.app.lhr.life/payment/return?code=TEST&status=failed",
  });
  console.log("QRIS OK");
  console.log("checkoutUrl:", res.checkoutUrl);
  console.log("expires:", res.expiresAt?.toISOString());
} catch (e) {
  console.log("QRIS FAILED:", (e as Error).message);
}
process.exit(0);

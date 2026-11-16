import "dotenv/config";
import { createCardPaymentPage } from "../../src/lib/doku.ts";
const res = await createCardPaymentPage({
  invoiceNumber: "PROBE-JS-" + Date.now(),
  amountIdr: 10000,
  payerEmail: "probe-js@example.com",
  description: "DOKU JS probe",
  successRedirectUrl: "https://example.com/return",
  failureRedirectUrl: "https://example.com/return?status=failed",
});
const raw = res.raw as any;
console.log("raw keys:", Object.keys(raw));
console.log("credit_card_js:", JSON.stringify(raw.credit_card_js ?? null));
console.log("credit_card_payment_page.url present:", !!raw.credit_card_payment_page?.url);
console.log("DOKU_PUBLIC_KEY set:", !!process.env.DOKU_PUBLIC_KEY, "| DOKU_API_KEY set:", !!process.env.DOKU_API_KEY);
process.exit(0);

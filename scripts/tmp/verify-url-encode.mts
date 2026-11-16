// Verify Bug-1 fix: a #INV/… invoice must yield a checkout URL whose '#' is
// percent-encoded (%23), so the hosted page reads the invoice from the query
// string instead of the fragment. Generates a payment page only (no charge).
// Run: node --experimental-strip-types --conditions react-server scripts/tmp/verify-url-encode.mts
import "dotenv/config";
import { createCardPaymentPage } from "../../src/lib/doku.ts";

const invoice = "#INV/2026/11/16/9999/ZZ";
const res = await createCardPaymentPage({
  invoiceNumber: invoice,
  amountIdr: 10000,
  payerEmail: "url-encode-check@example.com",
  description: "URL encode verification",
  successRedirectUrl: "https://aa88d59a543de5.app.lhr.life/payment/return?code=TEST",
  failureRedirectUrl: "https://aa88d59a543de5.app.lhr.life/payment/return?code=TEST&status=failed",
});

const url = res.checkoutUrl ?? "";
const rawHash = url.includes("#");
const encoded = url.includes("%23");
// The invoice must survive in the query string, not the fragment.
const q = new URL(url).searchParams.get("invoiceNumber");

console.log("url:", url);
console.log("contains raw '#':", rawHash, "(want false)");
console.log("contains '%23':", encoded, "(want true)");
console.log("invoiceNumber query param:", q, "(want", invoice + ")");
console.log(rawHash === false && encoded === true && q === invoice ? "PASS" : "FAIL");
process.exit(0);
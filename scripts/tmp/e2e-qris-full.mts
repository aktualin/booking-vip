import "dotenv/config";
import { db } from "../../src/prisma/db.ts";
import { createQrisCheckout } from "../../src/lib/doku.ts";
import { createRequire } from "node:module";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");
const code = "BV-QR" + Math.random().toString(36).slice(2,7).toUpperCase();
const invoice = "#INV/2026/11/16/" + Math.floor(1000+Math.random()*9000) + "/QR";
const bookingId = crypto.randomUUID();
await db.orm.public.Booking.create({ id:bookingId, code, status:"awaiting_payment", serviceAt:new Date(Date.now()+86400000), adultCount:1,childCount:0,infantCount:0, subtotalUsdCents:1000,addOnsUsdCents:0,totalUsdCents:1000, currencyCode:"USD",fxRate:1,invoiceNumber:invoice } as never);
await db.orm.public.Contact.create({ id:crypto.randomUUID(), bookingId, firstName:"QRIS",lastName:"Tester",email:"qris-test@example.com",phoneCountryCode:"ID",phone:"08123456789",isGuestSelf:true } as never);
const qrisMethod = (await db.orm.public.PaymentMethod.select("id").where({code:"QRIS"}).limit(1).all())[0];
const amountIdr = 165000;
const res = await createQrisCheckout({ invoiceNumber:invoice, amountIdr, payerEmail:"qris-test@example.com", description:"Booking VIP "+code, successRedirectUrl:"https://0197730e87daee.app.lhr.life/payment/return?code="+code, failureRedirectUrl:"https://0197730e87daee.app.lhr.life/payment/return?code="+code+"&status=failed" });
await db.orm.public.Payment.create({ id:crypto.randomUUID(), bookingId, methodId:qrisMethod?.id??null, status:"pending", amountUsdCents:1000,currencyCode:"USD",fxRate:16500, provider:"doku",providerRef:invoice,reference:invoice, providerAmountCents:amountIdr*100,providerCurrency:"IDR", checkoutUrl:res.checkoutUrl??null, expiresAt:res.expiresAt??null } as never);
console.log("booking:", code, "invoice:", invoice);
const browser = await chromium.launch();
const page = await browser.newPage();
let qrCode = "";
page.on("response", async (resp) => { try { if (resp.url().includes("generate-qris")) { const j=JSON.parse(await resp.text()); if (j.qr_code) qrCode=j.qr_code; } } catch {} });
await page.goto(res.checkoutUrl!, { waitUntil:"networkidle", timeout:60000 });
await page.waitForTimeout(4000);
const sim = await browser.newPage();
await sim.goto("https://sandbox.doku.com/qris-simulator/", { waitUntil:"networkidle", timeout:60000 });
await sim.waitForTimeout(2500);
await sim.getByRole("button",{name:"INPUT QR"}).click();
await sim.waitForTimeout(1200);
await sim.locator("textarea, input[type=text]").first().fill(qrCode);
await sim.waitForTimeout(600);
await sim.getByRole("button",{name:"CREATE"}).click();
await sim.waitForTimeout(3000);
// Choose Inbound (Off Us) — pay from another e-wallet/bank.
await sim.locator("input[type=radio]").first().check().catch(async()=>{ await sim.getByText("Inbound",{exact:false}).first().click(); });
await sim.waitForTimeout(500);
await sim.getByRole("button",{name:"PAY"}).click();
await sim.waitForTimeout(5000);
const simTxt = await sim.evaluate(()=>document.body.innerText);
console.log("=== simulator after PAY (first 300) ===");
console.log(simTxt.replace(/\s+/g," ").slice(0,300));
await sim.screenshot({ path:"scripts/tmp/qris-sim-paid.png", fullPage:true });
await browser.close();

// Poll for the DOKU webhook to confirm the booking.
console.log("waiting for DOKU webhook…");
let confirmed = false;
for (let i=0;i<24;i++){
  await new Promise(r=>setTimeout(r,5000));
  const ev = (await db.orm.public.PaymentWebhookEvent.select("eventType","outcome").where((f)=>f.provider.eq("doku")).orderBy((f)=>f.receivedAt.desc()).limit(1).all())[0];
  const pay = (await db.orm.public.Payment.select("status").where({providerRef:invoice}).limit(1).all())[0];
  const bk = (await db.orm.public.Booking.select("status").where({id:bookingId}).limit(1).all())[0];
  if (pay?.status==="paid" && bk?.status==="confirmed"){
    console.log("CONFIRMED via webhook ✓ | latest event:", ev?.eventType, ev?.outcome);
    confirmed = true; break;
  }
  if (i%4===0) console.log(`  …${(i+1)*5}s payment=${pay?.status} booking=${bk?.status}`);
}
const ev = (await db.orm.public.PaymentWebhookEvent.select("providerEventId","eventType","outcome","payload").where((f)=>f.provider.eq("doku")).orderBy((f)=>f.receivedAt.desc()).limit(1).all())[0];
const p = ev?.payload as any;
console.log("webhook event:", ev?.eventType, ev?.outcome, "| invoice in payload:", p?.order?.invoice_number, "| matches booking:", p?.order?.invoice_number===invoice);
console.log(confirmed ? "QRIS E2E: PASS ✅ (confirmed by DOKU callback)" : "QRIS E2E: not confirmed yet");
process.exit(0);

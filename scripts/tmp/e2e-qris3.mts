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
page.on("response", async (resp) => {
  try {
    if (resp.url().includes("generate-qris")) {
      const j = JSON.parse(await resp.text());
      if (j.qr_code) qrCode = j.qr_code;
    }
  } catch {}
});
await page.goto(res.checkoutUrl!, { waitUntil:"networkidle", timeout:60000 });
await page.waitForTimeout(4000);
console.log("qr_code len:", qrCode.length);
const sim = await browser.newPage();
await sim.goto("https://sandbox.doku.com/qris-simulator/", { waitUntil:"networkidle", timeout:60000 });
await sim.waitForTimeout(2500);
await sim.getByRole("button",{name:"INPUT QR"}).click();
await sim.waitForTimeout(1200);
await sim.locator("textarea, input[type=text]").first().fill(qrCode);
await sim.waitForTimeout(600);
await sim.getByRole("button",{name:"CREATE"}).click();
await sim.waitForTimeout(3500);
const txt = await sim.evaluate(()=>document.body.innerText);
console.log("=== after CREATE (first 600) ===");
console.log(txt.replace(/\s+/g," ").slice(0,600));
const ctrls = await sim.evaluate(()=>Array.from(document.querySelectorAll("input,select,button")).map(e=>({tag:e.tagName,type:(e as HTMLInputElement).type||"",ph:(e as HTMLInputElement).placeholder||"",txt:(e.textContent||"").trim().slice(0,30)})));
console.log("controls:", JSON.stringify(ctrls).slice(0,1000));
await sim.screenshot({ path:"scripts/tmp/qris-sim-created.png", fullPage:true });
await browser.close();
console.log("CHECK:", code, invoice);
process.exit(0);

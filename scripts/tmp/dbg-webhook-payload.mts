import "dotenv/config";
import { db } from "../../src/prisma/db.ts";
const e = (await db.orm.public.PaymentWebhookEvent
  .select("providerEventId","eventType","outcome","payload","receivedAt")
  .orderBy((f)=>f.receivedAt.desc())
  .limit(1).all())[0];
const p = e.payload as any;
console.log("event:", e.providerEventId, e.eventType, e.outcome, String(e.receivedAt).slice(0,19));
console.log("order:", JSON.stringify(p?.order));
console.log("transaction:", JSON.stringify(p?.transaction));
console.log("service/channel:", p?.service?.id, p?.channel?.id);
console.log("card_payment:", JSON.stringify(p?.card_payment));
// Compare against the paid H2H payment invoice
const pay = (await db.orm.public.Payment.select("providerRef","status").where((f)=>f.providerRef.eq("#INV/2026/11/16/8292/JU")).limit(1).all())[0];
console.log("H2H payment providerRef:", pay?.providerRef, pay?.status);
console.log("invoice match?", p?.order?.invoice_number === pay?.providerRef);
process.exit(0);

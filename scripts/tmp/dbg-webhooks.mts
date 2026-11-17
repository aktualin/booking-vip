import "dotenv/config";
import { db } from "../../src/prisma/db.ts";
const events = await db.orm.public.PaymentWebhookEvent
  .select("id","provider","providerEventId","eventType","outcome","receivedAt")
  .orderBy((f)=>f.receivedAt.desc())
  .limit(8)
  .all();
console.log("recent webhook events:");
for (const e of events) console.log(" ", e.provider, e.eventType, e.outcome, String(e.receivedAt).slice(0,19), e.providerEventId.slice(0,20));
const paid = await db.orm.public.Payment.select("providerRef","status","bookingId").where((f)=>f.status.eq("paid")).all();
console.log("paid payments:", paid.map(p=>p.providerRef));
process.exit(0);

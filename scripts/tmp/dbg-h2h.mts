import "dotenv/config";
import { db } from "../../src/prisma/db.ts";
const rows = await db.orm.public.Payment
  .select("id","bookingId","status","provider","providerRef","createdAt")
  .where((f)=>f.provider.eq("doku"))
  .orderBy((f)=>f.createdAt.desc())
  .limit(4)
  .all();
for (const r of rows) {
  const raw = (await db.orm.public.Payment.select("rawPayload").where({id:r.id}).all())[0]?.rawPayload as any;
  const b = (await db.orm.public.Booking.select("code","status").where({id:r.bookingId}).limit(1).all())[0];
  console.log(JSON.stringify({
    id: r.id.slice(0,8), created: String(r.createdAt).slice(0,19),
    status: r.status, invoice: r.providerRef, booking: b?.code, bookingStatus: b?.status,
    three_ds: raw?.three_ds ? "present" : "none",
    payment_status: raw?.payment?.status ?? null,
    response_message: raw?.payment?.response_message ?? null,
  }));
}
process.exit(0);

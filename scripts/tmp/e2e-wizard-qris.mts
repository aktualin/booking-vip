import { createRequire } from "node:module";
import "dotenv/config";
const require = createRequire("/opt/homebrew/lib/node_modules/");
const { chromium } = require("playwright");
const URL = "http://localhost:3000/booking/daihatsu-terios?pkg=efb3745b-9b0c-42a3-a721-6f9af18a8203&date=2026-11-17&time=09:00&days=1&driverOption=without_driver";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(()=>localStorage.setItem("booking-vip:locale",JSON.stringify("id")));
const page = await ctx.newPage();
try {
  await page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
  await page.getByRole("button",{name:"Lanjutkan"}).waitFor({timeout:30000});
  await page.getByRole("button",{name:"Lanjutkan"}).click();
  await page.getByText("Identitas Penyewa").waitFor({timeout:20000});
  await page.locator('input[type="text"]').nth(0).fill("QRIS");
  await page.locator('input[type="text"]').nth(1).fill("Wizard");
  await page.locator('input[type="email"]').fill("qris-wizard@example.com");
  await page.locator('input[type="tel"]').fill("08123456789");
  await page.locator('select:has(option[value="ktp"])').selectOption("ktp");
  await page.getByLabel("NIK").fill("3201234567890009");
  await page.setInputFiles('input[type="file"][accept*="application/pdf"]',{name:"ktp.png",mimeType:"image/png",buffer:PNG});
  await page.getByText("Dokumen terunggah").waitFor({timeout:30000});
  await page.getByRole("button",{name:"Lanjut ke tanda tangan"}).click();
  const canvas = page.locator("canvas");
  await canvas.waitFor({timeout:20000});
  await canvas.evaluate(el=>el.scrollIntoView({block:"center"}));
  await page.waitForTimeout(800);
  const saveBtn = page.getByRole("button",{name:"Simpan tanda tangan"});
  for (let a=0;a<4 && !(await saveBtn.isEnabled());a++){
    await page.evaluate(()=>{const c=document.querySelector("canvas");if(!c)return;const r=c.getBoundingClientRect();const b={bubbles:true,cancelable:true,pointerId:1,pointerType:"mouse",button:0,buttons:1};const pt=(x:number,y:number)=>({...b,clientX:x,clientY:y});const cy=r.top+r.height/2;c.dispatchEvent(new PointerEvent("pointerdown",pt(r.left+40,cy)));c.dispatchEvent(new PointerEvent("pointermove",pt(r.left+r.width*0.5,cy-30)));c.dispatchEvent(new PointerEvent("pointermove",pt(r.left+r.width-40,cy+20)));c.dispatchEvent(new PointerEvent("pointerup",{...b,buttons:0,clientX:r.left+r.width-40,clientY:cy+20}));});
    await page.waitForTimeout(400);
  }
  await saveBtn.click();
  await page.getByText("Tanda tangan tersimpan").waitFor({timeout:30000});
  await page.getByRole("button",{name:"Lanjut ke Pembayaran"}).click();
  // Payment step: select QRIS, then Bayar Sekarang.
  await page.getByRole("radio",{name:/QRIS/}).waitFor({timeout:30000});
  await page.getByRole("radio",{name:/QRIS/}).click();
  await page.waitForTimeout(500);
  await page.screenshot({path:"scripts/tmp/qris-wizard-payment.png",fullPage:true});
  await page.getByRole("button",{name:"Bayar Sekarang"}).click();
  await page.waitForURL(/checkout-link-v2|doku\.com/,{timeout:40000});
  console.log("redirected to DOKU QRIS checkout:", page.url().slice(0,80)+"…");
  console.log(/checkout-link-v2/.test(page.url()) ? "WIZARD QRIS: PASS ✅" : "WIZARD QRIS: check URL");
} catch(e){
  await page.screenshot({path:"scripts/tmp/qris-wizard-error.png",fullPage:true}).catch(()=>{});
  console.error("ERROR:",(e as Error).message);
} finally { await browser.close(); process.exit(0); }

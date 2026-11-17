#!/usr/bin/env node --experimental-strip-types
// Idempotent seed of the e-VOA service foundation.
//
// Run:  npm run db:seed-evoa
//
// Seeds:
//   * Country.voaEligible — the 97 nationalities eligible for the Indonesian
//     e-VOA (official Imigrasi FAQ list). Every other country is set false.
//   * Airport rows for the immigration checkpoints (TPI) served by e-VOA.
//   * The "evoa" ServiceLine (when missing) and two products: the handling
//     service ("evoa-b1") and the official immigration fee line
//     ("evoa-official-fee", hidden from the catalog).
//   * Settings: official fee (IDR), service fee (USD cents), group limit, SLA.
//     Existing values are NEVER overwritten — the operator owns them.
//   * A few default dynamic form fields (EvoaFormField), created once.
//
// Re-running is safe: rows are looked up by their natural key.

import "dotenv/config";
import { db } from "../src/prisma/db.ts";

let created = 0;
let updated = 0;
let skipped = 0;

function bump(label: string, action: "created" | "updated" | "skipped") {
  if (action === "created") created++;
  else if (action === "updated") updated++;
  else skipped++;
  console.log(`  ${label}: ${action}`);
}

/* ------------------------------------------------------------------ */
/* 97 e-VOA eligible countries (Imigrasi FAQ, Sep 2026)                */
/* ------------------------------------------------------------------ */

const ELIGIBLE: { code: string; name: string; dialCode: string }[] = [
  { code: "ZA", name: "South Africa", dialCode: "+27" },
  { code: "AL", name: "Albania", dialCode: "+355" },
  { code: "US", name: "United States", dialCode: "+1" },
  { code: "AD", name: "Andorra", dialCode: "+376" },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966" },
  { code: "AR", name: "Argentina", dialCode: "+54" },
  { code: "AM", name: "Armenia", dialCode: "+374" },
  { code: "AU", name: "Australia", dialCode: "+61" },
  { code: "AT", name: "Austria", dialCode: "+43" },
  { code: "BH", name: "Bahrain", dialCode: "+973" },
  { code: "NL", name: "Netherlands", dialCode: "+31" },
  { code: "BY", name: "Belarus", dialCode: "+375" },
  { code: "BE", name: "Belgium", dialCode: "+32" },
  { code: "BR", name: "Brazil", dialCode: "+55" },
  { code: "BN", name: "Brunei Darussalam", dialCode: "+673" },
  { code: "BA", name: "Bosnia and Herzegovina", dialCode: "+387" },
  { code: "BG", name: "Bulgaria", dialCode: "+359" },
  { code: "CZ", name: "Czech Republic", dialCode: "+420" },
  { code: "CL", name: "Chile", dialCode: "+56" },
  { code: "DK", name: "Denmark", dialCode: "+45" },
  { code: "EC", name: "Ecuador", dialCode: "+593" },
  { code: "EE", name: "Estonia", dialCode: "+372" },
  { code: "PH", name: "Philippines", dialCode: "+63" },
  { code: "FI", name: "Finland", dialCode: "+358" },
  { code: "GT", name: "Guatemala", dialCode: "+502" },
  { code: "HK", name: "Hong Kong", dialCode: "+852" },
  { code: "HU", name: "Hungary", dialCode: "+36" },
  { code: "IN", name: "India", dialCode: "+91" },
  { code: "GB", name: "United Kingdom", dialCode: "+44" },
  { code: "IE", name: "Ireland", dialCode: "+353" },
  { code: "IT", name: "Italy", dialCode: "+39" },
  { code: "IS", name: "Iceland", dialCode: "+354" },
  { code: "JP", name: "Japan", dialCode: "+81" },
  { code: "DE", name: "Germany", dialCode: "+49" },
  { code: "KH", name: "Cambodia", dialCode: "+855" },
  { code: "CA", name: "Canada", dialCode: "+1" },
  { code: "KZ", name: "Kazakhstan", dialCode: "+7" },
  { code: "KE", name: "Kenya", dialCode: "+254" },
  { code: "CO", name: "Colombia", dialCode: "+57" },
  { code: "KR", name: "South Korea", dialCode: "+82" },
  { code: "HR", name: "Croatia", dialCode: "+385" },
  { code: "KW", name: "Kuwait", dialCode: "+965" },
  { code: "LA", name: "Laos", dialCode: "+856" },
  { code: "LV", name: "Latvia", dialCode: "+371" },
  { code: "LI", name: "Liechtenstein", dialCode: "+423" },
  { code: "LT", name: "Lithuania", dialCode: "+370" },
  { code: "LU", name: "Luxembourg", dialCode: "+352" },
  { code: "MO", name: "Macau", dialCode: "+853" },
  { code: "MV", name: "Maldives", dialCode: "+960" },
  { code: "MY", name: "Malaysia", dialCode: "+60" },
  { code: "MT", name: "Malta", dialCode: "+356" },
  { code: "MA", name: "Morocco", dialCode: "+212" },
  { code: "MX", name: "Mexico", dialCode: "+52" },
  { code: "EG", name: "Egypt", dialCode: "+20" },
  { code: "MC", name: "Monaco", dialCode: "+377" },
  { code: "MN", name: "Mongolia", dialCode: "+976" },
  { code: "MZ", name: "Mozambique", dialCode: "+258" },
  { code: "MM", name: "Myanmar", dialCode: "+95" },
  { code: "NO", name: "Norway", dialCode: "+47" },
  { code: "OM", name: "Oman", dialCode: "+968" },
  { code: "PS", name: "Palestine", dialCode: "+970" },
  { code: "PG", name: "Papua New Guinea", dialCode: "+675" },
  { code: "FR", name: "France", dialCode: "+33" },
  { code: "PE", name: "Peru", dialCode: "+51" },
  { code: "PL", name: "Poland", dialCode: "+48" },
  { code: "PT", name: "Portugal", dialCode: "+351" },
  { code: "QA", name: "Qatar", dialCode: "+974" },
  { code: "RO", name: "Romania", dialCode: "+40" },
  { code: "RU", name: "Russia", dialCode: "+7" },
  { code: "RW", name: "Rwanda", dialCode: "+250" },
  { code: "SM", name: "San Marino", dialCode: "+378" },
  { code: "NZ", name: "New Zealand", dialCode: "+64" },
  { code: "RS", name: "Serbia", dialCode: "+381" },
  { code: "SC", name: "Seychelles", dialCode: "+248" },
  { code: "SG", name: "Singapore", dialCode: "+65" },
  { code: "CY", name: "Cyprus", dialCode: "+357" },
  { code: "SK", name: "Slovakia", dialCode: "+421" },
  { code: "SI", name: "Slovenia", dialCode: "+386" },
  { code: "ES", name: "Spain", dialCode: "+34" },
  { code: "SR", name: "Suriname", dialCode: "+597" },
  { code: "SE", name: "Sweden", dialCode: "+46" },
  { code: "CH", name: "Switzerland", dialCode: "+41" },
  { code: "TW", name: "Taiwan", dialCode: "+886" },
  { code: "TZ", name: "Tanzania", dialCode: "+255" },
  { code: "TH", name: "Thailand", dialCode: "+66" },
  { code: "TL", name: "Timor-Leste", dialCode: "+670" },
  { code: "CN", name: "China", dialCode: "+86" },
  { code: "TN", name: "Tunisia", dialCode: "+216" },
  { code: "TR", name: "Türkiye", dialCode: "+90" },
  { code: "AE", name: "United Arab Emirates", dialCode: "+971" },
  { code: "UZ", name: "Uzbekistan", dialCode: "+998" },
  { code: "UA", name: "Ukraine", dialCode: "+380" },
  { code: "VA", name: "Vatican City", dialCode: "+39" },
  { code: "VE", name: "Venezuela", dialCode: "+58" },
  { code: "VN", name: "Vietnam", dialCode: "+84" },
  { code: "JO", name: "Jordan", dialCode: "+962" },
  { code: "GR", name: "Greece", dialCode: "+30" },
];

async function seedCountries() {
  console.log("Country (voaEligible)");
  const eligibleCodes = new Set(ELIGIBLE.map((c) => c.code));

  for (const r of ELIGIBLE) {
    const existing = await db.orm.public.Country
      .select("id", "voaEligible")
      .where({ code: r.code })
      .first();
    if (existing) {
      if (existing.voaEligible !== true) {
        await db.orm.public.Country.where({ id: existing.id }).update({ voaEligible: true });
        bump(`Country ${r.code}`, "updated");
      } else {
        bump(`Country ${r.code}`, "skipped");
      }
      continue;
    }
    await db.orm.public.Country.create({
      id: crypto.randomUUID(),
      code: r.code,
      name: r.name,
      dialCode: r.dialCode,
      active: true,
      voaEligible: true,
    });
    bump(`Country ${r.code}`, "created");
  }

  // Everything outside the official list is not eligible.
  const others = await db.orm.public.Country
    .select("id", "code")
    .where({ voaEligible: true })
    .all();
  for (const row of others) {
    if (!eligibleCodes.has(row.code)) {
      await db.orm.public.Country.where({ id: row.id }).update({ voaEligible: false });
      bump(`Country ${row.code} → not eligible`, "updated");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Immigration checkpoints (TPI) — the airports serving e-VOA          */
/* ------------------------------------------------------------------ */

const TPI: { iata: string; name: string; city: string }[] = [
  { iata: "CGK", name: "Soekarno-Hatta International Airport", city: "Tangerang" },
  { iata: "HLP", name: "Halim Perdanakusuma International Airport", city: "Jakarta" },
  { iata: "DPS", name: "I Gusti Ngurah Rai International Airport", city: "Denpasar" },
  { iata: "SUB", name: "Juanda International Airport", city: "Surabaya" },
  { iata: "KNO", name: "Kualanamu International Airport", city: "Deli Serdang" },
  { iata: "YIA", name: "Yogyakarta International Airport", city: "Kulon Progo" },
  { iata: "UPG", name: "Sultan Hasanuddin International Airport", city: "Makassar" },
  { iata: "MDC", name: "Sam Ratulangi International Airport", city: "Manado" },
  { iata: "LOP", name: "Zainuddin Abdul Madjid International Airport", city: "Lombok" },
  { iata: "BPN", name: "Sultan Aji Muhammad Sulaiman Sepinggan Airport", city: "Balikpapan" },
  { iata: "BTH", name: "Hang Nadim International Airport", city: "Batam" },
  { iata: "PKU", name: "Sultan Syarif Kasim II International Airport", city: "Pekanbaru" },
  { iata: "PLM", name: "Sultan Mahmud Badaruddin II International Airport", city: "Palembang" },
  { iata: "PDG", name: "Minangkabau International Airport", city: "Padang" },
  { iata: "PNK", name: "Supadio International Airport", city: "Pontianak" },
  { iata: "BDJ", name: "Syamsudin Noor International Airport", city: "Banjarbaru" },
  { iata: "SRG", name: "Jenderal Ahmad Yani International Airport", city: "Semarang" },
  { iata: "SOC", name: "Adisumarmo International Airport", city: "Surakarta" },
];

async function seedAirports() {
  console.log("Airport (TPI)");
  for (const r of TPI) {
    const existing = await db.orm.public.Airport
      .select("id")
      .where({ iataCode: r.iata })
      .first();
    if (existing) {
      bump(`Airport ${r.iata}`, "skipped");
      continue;
    }
    await db.orm.public.Airport.create({
      id: crypto.randomUUID(),
      kind: "airport",
      level: "airport",
      iataCode: r.iata,
      name: r.name,
      city: r.city,
      country: "Indonesia",
      active: true,
    });
    bump(`Airport ${r.iata}`, "created");
  }
}

/* ------------------------------------------------------------------ */
/* ServiceLine + products                                              */
/* ------------------------------------------------------------------ */

async function seedCatalog() {
  console.log("ServiceLine + Product");

  let line = await db.orm.public.ServiceLine
    .select("id")
    .where({ slug: "evoa" })
    .first();
  if (!line) {
    const id = crypto.randomUUID();
    await db.orm.public.ServiceLine.create({
      id,
      slug: "evoa",
      label: "e-VOA",
      short: "Electronic Visa on Arrival",
      tone: "from-sky-400 to-blue-600",
      sortOrder: 40,
      active: true,
    });
    line = { id };
    bump("ServiceLine evoa", "created");
  } else {
    bump("ServiceLine evoa", "skipped");
  }

  const products = [
    {
      slug: "evoa-b1",
      title: "e-VOA B1 — Visa on Arrival Handling",
      titleId: "e-VOA B1 — Jasa Pengurusan Visa on Arrival",
      description:
        "We apply for the Indonesian e-VOA (B1) on your behalf. Price is per applicant and includes our handling service; the official immigration fee is charged separately.",
      descriptionId:
        "Kami mengajukan e-VOA (B1) Indonesia untuk Anda. Harga per pemohon sudah termasuk jasa pengurusan; biaya resmi imigrasi ditagihkan terpisah.",
      active: true,
    },
    {
      slug: "evoa-official-fee",
      title: "Official e-VOA Fee (Directorate General of Immigration)",
      titleId: "Biaya Resmi e-VOA (Ditjen Imigrasi)",
      description:
        "The official IDR 500,000 visa fee charged by Indonesian Immigration, converted at the rate of the checkout moment.",
      descriptionId:
        "Biaya visa resmi IDR 500.000 dari Imigrasi Indonesia, dikonversi dengan kurs saat checkout.",
      // Hidden from the catalog — only used as a booking line item.
      active: false,
    },
  ];

  for (const p of products) {
    const existing = await db.orm.public.Product
      .select("id")
      .where({ slug: p.slug })
      .first();
    if (existing) {
      bump(`Product ${p.slug}`, "skipped");
      continue;
    }
    await db.orm.public.Product.create({
      id: crypto.randomUUID(),
      slug: p.slug,
      lineId: line.id,
      title: p.title,
      titleId: p.titleId,
      description: p.description,
      descriptionId: p.descriptionId,
      active: p.active,
    });
    bump(`Product ${p.slug}`, "created");
  }
}

/* ------------------------------------------------------------------ */
/* Settings — created once, then operator-owned                        */
/* ------------------------------------------------------------------ */

const SETTINGS: Record<string, unknown> = {
  "evoa.officialFeeIdr": 500000,
  "evoa.serviceFeeUsdCents": 1500,
  "evoa.maxApplicants": 5,
  "evoa.slaHours": 24,
  "evoa.minLeadTimeDays": 2,
};

async function seedSettings() {
  console.log("Setting");
  for (const [key, value] of Object.entries(SETTINGS)) {
    const existing = await db.orm.public.Setting.select("key").where({ key }).first();
    if (existing) {
      bump(`Setting ${key}`, "skipped");
      continue;
    }
    await db.orm.public.Setting.create({ key, value: value as never });
    bump(`Setting ${key}`, "created");
  }
}

/* ------------------------------------------------------------------ */
/* Default dynamic fields                                              */
/* ------------------------------------------------------------------ */

const FIELDS = [
  {
    key: "sponsor_name",
    labelEn: "Sponsor / contact person in Indonesia",
    labelId: "Sponsor / kontak di Indonesia",
    type: "text",
    scope: "application",
    required: false,
    sortOrder: 10,
    showWhen: null,
  },
  {
    key: "sponsor_phone",
    labelEn: "Sponsor phone number",
    labelId: "Nomor telepon sponsor",
    type: "text",
    scope: "application",
    required: false,
    sortOrder: 20,
    showWhen: null,
  },
  {
    key: "company_name",
    labelEn: "Company name",
    labelId: "Nama perusahaan",
    type: "text",
    scope: "applicant",
    required: true,
    sortOrder: 30,
    showWhen: { field: "purpose", equals: "business_meeting" },
  },
  {
    key: "invitation_letter",
    labelEn: "Invitation letter",
    labelId: "Surat undangan",
    type: "file",
    scope: "applicant",
    required: false,
    maxFiles: 3,
    sortOrder: 40,
    showWhen: { field: "purpose", equals: "business_meeting" },
  },
];

async function seedFields() {
  console.log("EvoaFormField");
  for (const f of FIELDS) {
    const existing = await db.orm.public.EvoaFormField
      .select("id")
      .where({ key: f.key })
      .first();
    if (existing) {
      bump(`Field ${f.key}`, "skipped");
      continue;
    }
    await db.orm.public.EvoaFormField.create({
      id: crypto.randomUUID(),
      key: f.key,
      labelEn: f.labelEn,
      labelId: f.labelId,
      type: f.type,
      scope: f.scope,
      required: f.required,
      options: [],
      showWhen: (f.showWhen ?? null) as never,
      maxFiles: "maxFiles" in f ? (f as { maxFiles: number }).maxFiles : null,
      sortOrder: f.sortOrder,
      active: true,
    });
    bump(`Field ${f.key}`, "created");
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  await seedCountries();
  await seedAirports();
  await seedCatalog();
  await seedSettings();
  await seedFields();
  console.log(`\nDone — created ${created}, updated ${updated}, skipped ${skipped}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
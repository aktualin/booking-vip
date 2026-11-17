#!/usr/bin/env node --experimental-strip-types
// Seeds the operator-managed scaffolding — search fields, service line copy
// and settings — from the data that already exists in `src/data/*.ts`, the
// i18n dictionaries and the Indonesian copy in `src/data/content.id.ts`.
//
// The content tables (promos, banners, articles, destinations, SEO links and
// blocks) are NOT seeded: they hold the operator's own data, entered through
// the admin UI. Seeding placeholder rows here used to put demo content on
// the home page that had nothing to do with the business.
//
// Run through `npm run db:seed` (which calls this after the domain seed).
// Every write is an upsert keyed by a unique slug, so re-running is safe and
// keeps the database in sync with the source files.

import { db } from "../src/prisma/db.ts";
import { serviceNav, servicePages, serviceSearchFields } from "../src/data/services.ts";
import { evoaHowItWorks } from "../src/data/evoa.ts";
import {
  searchFieldCopyId,
  servicePageCopyId,
} from "../src/data/content.id.ts";
import { en } from "../src/i18n/en.ts";
import { id as idDict } from "../src/i18n/id.ts";

export type SeedCounts = Record<string, { created: number; existing: number }>;

function bump(counts: SeedCounts, table: string, created: boolean) {
  counts[table] ??= { created: 0, existing: 0 };
  if (created) counts[table].created++;
  else counts[table].existing++;
}

/** Both languages of a dictionary key. */
function copy(key: keyof typeof en): { en: string; id: string } {
  return { en: en[key], id: idDict[key] };
}

// ---------------------------------------------------------------------------
// Search fields (per service line)
// ---------------------------------------------------------------------------
export async function seedSearchFields(
  counts: SeedCounts,
  lineIds: Record<string, string>
) {
  for (const nav of serviceNav) {
    const slug = nav.href.replace(/^\//, "");
    const lineId = lineIds[slug];
    if (!lineId) continue;

    const fields = serviceSearchFields[nav.label] ?? [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      const alt = searchFieldCopyId[`${slug}:${f.key}`];

      const payload = {
        labelEn: f.label,
        labelId: alt?.label ?? null,
        placeholderEn: f.placeholder ?? null,
        placeholderId: alt?.placeholder ?? null,
        icon: f.icon,
        kind: f.kind,
        sortOrder: i,
        active: true,
      };

      const existing = await db.orm.public.SearchField
        .select("id")
        .where({ lineId, key: f.key })
        .first();
      if (existing) {
        await db.orm.public.SearchField.where({ id: existing.id }).update(payload);
        bump(counts, "SearchField", false);
        continue;
      }
      await db.orm.public.SearchField.create({
        id: crypto.randomUUID(),
        lineId,
        key: f.key,
        ...payload,
      });
      bump(counts, "SearchField", true);
    }
  }
}

// ---------------------------------------------------------------------------
// Service line copy (intro, sections, highlights, tabs)
// ---------------------------------------------------------------------------
export async function seedServiceLineCopy(
  counts: SeedCounts,
  lineIds: Record<string, string>
) {
  for (const [slug, page] of Object.entries(servicePages)) {
    const lineId = lineIds[slug];
    if (!lineId) continue;

    const alt = servicePageCopyId[slug];

    const existing = await db.orm.public.ServiceLine.select("id").where({ id: lineId }).first();
    if (!existing) continue;

    await db.orm.public.ServiceLine
      .where({ id: lineId })
      .update({
        introEn: page.intro,
        introId: alt?.intro ?? null,
        sections: page.sections as unknown as [],
        sectionsId: (alt?.sections ?? page.sections) as unknown as [],
        highlights: page.highlights as unknown as [],
        highlightsId: (alt?.highlights ?? page.highlights) as unknown as [],
        tabs: page.tabs as unknown as [],
        tabsId: (alt?.tabs ?? page.tabs) as unknown as [],
      });
    bump(counts, "ServiceLine", false);
  }
}

// ---------------------------------------------------------------------------
// Settings — hero copy, footer, tabs, time slots, home section copy
// ---------------------------------------------------------------------------

/** The home page bands — eyebrow/title/see-all copy per section. */
const homeSections = [
  {
    key: "specialDeals",
    eyebrow: null,
    title: copy("home.specialDeals"),
    seeAll: null,
    seeAllHref: "",
    lineSlug: null,
  },
  {
    key: "vip",
    eyebrow: copy("home.vipEyebrow"),
    title: copy("home.vipTitle"),
    seeAll: copy("home.vipSeeAll"),
    seeAllHref: "/vip-service",
    lineSlug: "vip-service",
  },
  {
    key: "transport",
    eyebrow: copy("home.transportEyebrow"),
    title: copy("home.transportTitle"),
    seeAll: copy("home.transportSeeAll"),
    seeAllHref: "/transport",
    lineSlug: "transport",
  },
  {
    key: "tour",
    eyebrow: copy("home.tourEyebrow"),
    title: copy("home.tourTitle"),
    seeAll: copy("home.tourSeeAll"),
    seeAllHref: "/tour-package",
    lineSlug: "tour-package",
  },
  {
    key: "destinations",
    eyebrow: null,
    title: copy("home.destinationsTitle"),
    seeAll: copy("home.destinationsSeeAll"),
    seeAllHref: "",
    lineSlug: null,
  },
  {
    key: "evoa",
    eyebrow: copy("home.evoaEyebrow"),
    title: copy("home.evoaTitle"),
    seeAll: copy("home.evoaSeeAll"),
    seeAllHref: "/evoa",
    lineSlug: "evoa",
  },
  {
    key: "promos",
    eyebrow: null,
    title: copy("home.promosTitle"),
    seeAll: copy("home.promosSeeAll"),
    seeAllHref: "",
    lineSlug: null,
  },
  {
    key: "articles",
    eyebrow: null,
    title: copy("home.articlesTitle"),
    seeAll: null,
    seeAllHref: "",
    lineSlug: null,
  },
  {
    key: "recommendations",
    eyebrow: null,
    title: copy("home.recommendationsTitle"),
    seeAll: null,
    seeAllHref: "",
    lineSlug: null,
  },
  {
    key: "exploreServices",
    eyebrow: null,
    title: copy("home.exploreServicesTitle"),
    seeAll: null,
    seeAllHref: "",
    lineSlug: null,
  },
];

export const settingValues: Record<string, unknown> = {
  "hero.copy": {
    en: {
      heading1: en["hero.heading1"],
      heading2: en["hero.heading2"],
      subtitle: en["hero.subtitle"],
      promo: en["hero.promo"],
      promoCta: en["hero.promoCta"],
    },
    id: {
      heading1: idDict["hero.heading1"],
      heading2: idDict["hero.heading2"],
      subtitle: idDict["hero.subtitle"],
      promo: idDict["hero.promo"],
      promoCta: idDict["hero.promoCta"],
    },
  },
  "home.sections": homeSections,
  "search.timeSlots": [
    "06:00",
    "08:00",
    "10:00",
    "12:00",
    "14:00",
    "16:00",
    "18:00",
    "20:00",
    "22:00",
  ],

  // The three "how it works" steps of the e-VOA application form.
  "evoa.howItWorks": evoaHowItWorks,

  // The booking rules of the airport VIP tool. One JSON key rather than one
  // row per rule: `seedSettings` deletes every key it does not know about, and
  // an object value can never be mistaken for a tax by `listTaxSettings`.
  "booking.rules": {
    minLeadHours: 24,
    shortNoticePercent: 0,
    overnightPercent: 30,
    overnightFrom: "22:00",
    overnightTo: "06:00",
    weekendPercent: 0,
    holidayPercent: 0,
    infantDiscountPercent: 0,
    childDiscountPercent: 0,
  },

  // What the greeter does, per airport. This belongs in `Product.included`,
  // but that column is empty for every VIP product and writes to `Product`
  // are blocked by the pending migration — the reader prefers the column the
  // moment it is filled.
  "vip.serviceInfo": {
    default: {
      steps: [
        "Greeter menyambut kamu di ujung garbarata",
        "Bantuan pengurusan Visa on Arrival bila diperlukan",
        "Jalur khusus melewati imigrasi",
        "Pengambilan seluruh bagasi tercatat",
        "Pendampingan melewati bea cukai beserta porter",
        "Pengantaran ke penjemput, sopir, atau area kedatangan",
      ],
      note: "Data paspor setiap penumpang mungkin diminta sebelum konfirmasi akhir. Pengambilan foto dan video dilarang di area imigrasi, bea cukai, dan pengambilan bagasi — ini aturan otoritas bandara.",
    },
    CGK: {
      steps: [
        "Greeter menyambut kamu di ujung garbarata",
        "Bantuan pengurusan Visa on Arrival bila diperlukan",
        "Jalur khusus melewati imigrasi",
        "Pengambilan seluruh bagasi tercatat",
        "Pendampingan melewati bea cukai beserta porter",
        "Pengantaran ke penjemput hotel, sopir, atau penyambut",
        "Pendampingan menunggu kendaraan tiba",
        "Bantuan memuat bagasi ke kendaraan",
      ],
      note: "Buggy listrik tidak tersedia di CGK. Greeter membantu bagasi berukuran normal dalam jumlah wajar; porter tambahan dapat diatur dengan biaya terpisah. Penumpang penerbangan internasional wajib mengisi deklarasi bea cukai online di https://ecd.beacukai.go.id/ sebelum terbang dan menunjukkan QR code-nya kepada petugas.",
    },
    DPS: {
      steps: [
        "Greeter menyambut kamu di ujung garbarata",
        "Bantuan pengurusan Visa on Arrival bila diperlukan",
        "Jalur khusus melewati imigrasi",
        "Pengambilan seluruh bagasi tercatat",
        "Pendampingan melewati bea cukai beserta porter",
        "Pengantaran ke area penjemputan",
      ],
      note: "Penumpang penerbangan internasional wajib mengisi deklarasi bea cukai online sebelum terbang. Buggy listrik tersedia terbatas dan tidak dijamin.",
    },
  },

  // Taxes — key → value. A value ending with "%" is a percentage of the
  // subtotal, a value starting with "$" is a fixed amount in USD.
  "pph12": "11%",
  "pph11": "9%",
  "service_fee": "$1",
};

/**
 * The loyalty rewards catalog — operator-defined key/value data.
 *
 * `kind` decides how the voucher discounts a booking:
 *   - "percent" → `value` is a percentage (0-100) off the subtotal,
 *   - "amount"  → `value` is a flat cut in integer USD cents,
 *   - "free"    → full cover capped at `value` (integer USD cents).
 *
 * `pointsCost` is the points price, `expiresDays` the voucher validity.
 * The seed only creates the key when it is missing — operator edits survive
 * re-seeding (the key is admin-managed, see below).
 */
const loyaltyRewardsDefault = [
  {
    key: "diskon-10",
    name: "Diskon 10% pemesanan berikutnya",
    pointsCost: 500,
    kind: "percent",
    value: 10,
    expiresDays: 30,
    description: "Berlaku untuk semua layanan, satu kali pakai.",
  },
  {
    key: "potongan-5",
    name: "Potongan $5",
    pointsCost: 400,
    kind: "amount",
    value: 500,
    expiresDays: 30,
    description: "Potongan langsung $5 dari total pesanan.",
  },
  {
    key: "potongan-15",
    name: "Potongan $15",
    pointsCost: 1000,
    kind: "amount",
    value: 1500,
    expiresDays: 60,
    description: "Potongan $15 untuk pesanan apa pun, berlaku 60 hari.",
  },
  {
    key: "gratis-addon",
    name: "Gratis add-on hingga $25",
    pointsCost: 1500,
    kind: "free",
    value: 2500,
    expiresDays: 30,
    description: "Menutup penuh biaya add-on (atau total pesanan) sampai $25.",
  },
];

/**
 * Settings written by the admin UI — the seed never overwrites or deletes
 * them. `loyalty.rewards` is created with defaults when missing, then left
 * to the operator.
 */
const adminManagedSettingKeys = ["home.popup", "loyalty.rewards", "promo.campaigns", "orderNotifications"];

export async function seedSettings(counts: SeedCounts) {
  // The rewards catalog: seed the defaults once, never overwrite an
  // operator's edits afterwards.
  const rewardsExisting = await db.orm.public.Setting
    .select("key")
    .where({ key: "loyalty.rewards" })
    .first();
  if (!rewardsExisting) {
    await db.orm.public.Setting.create({
      key: "loyalty.rewards",
      value: loyaltyRewardsDefault as never,
    });
    bump(counts, "Setting", true);
  }

  for (const [key, value] of Object.entries(settingValues)) {
    const existing = await db.orm.public.Setting.select("key").where({ key }).first();
    if (existing) {
      await db.orm.public.Setting.where({ key }).update({ value: value as never });
      bump(counts, "Setting", false);
      continue;
    }
    await db.orm.public.Setting.create({
      key,
      value: value as never,
    });
    bump(counts, "Setting", true);
  }

  // Drop settings that are no longer managed by the seed — otherwise stale
  // keys linger in the database and confuse the read path.
  //
  // The admin-managed settings are never touched: they are written by the
  // admin UI, not by the seed.
  const managed = new Set([
    ...Object.keys(settingValues),
    ...adminManagedSettingKeys,
  ]);
  const rows = await db.orm.public.Setting.select("key").all();
  for (const row of rows) {
    if (managed.has(row.key)) continue;
    await db.orm.public.Setting.where({ key: row.key }).delete();
    bump(counts, "Setting", false);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
export async function seedContent(
  counts: SeedCounts,
  lineIds: Record<string, string>
) {
  await seedSearchFields(counts, lineIds);
  await seedServiceLineCopy(counts, lineIds);
  await seedSettings(counts);
}

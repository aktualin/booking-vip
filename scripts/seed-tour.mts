#!/usr/bin/env node --experimental-strip-types
// Idempotent seed of the Bali tour operation (Bali tour-operator standard).
//
// Run:  node --experimental-strip-types scripts/seed-tour.mts
//   (or `npm run db:seed-tour` from repo root)
//
// What it seeds:
//   - the missing Bali destination places (Kintamani, Bedugul, Gunung Batur),
//     reusing the rows scripts/seed.mts already created (Ubud, Tanah Lot,
//     Pura Uluwatu, Nusa Penida);
//   - five 1-day Bali tours, each as TWO products: a "private" product
//     (per mobil) and a "-join-in" sibling (per pax, scheduled departures);
//   - one package per product: per_unit "Private Car (max 6 pax)" with a
//     10-hour duration + overtime rate, or per_pax "Standard" (child 75%,
//     infant free);
//   - daily open join-in departures for the next 30 days (quota 12);
//   - the operator roster: 3 drivers + 3 vehicles.
//
// Re-running is safe: every row is looked up by its natural key (slug,
// (productId, label), (productId, date, startTime), phone, name) and only
// inserted when missing. Existing rows are never modified or deleted.

import "dotenv/config";
import { db } from "../src/prisma/db.ts";
import type { TourItineraryDay } from "../src/types/tour.ts";

// ---------- tiny helpers ----------
const counts: Record<string, { created: number; existing: number }> = {};
function bump(table: string, created: boolean) {
  counts[table] ??= { created: 0, existing: 0 };
  if (created) counts[table].created++;
  else counts[table].existing++;
}

// ---------- shared bilingual lists (the Bali tour standard) ----------
const INCLUDED_EN = [
  "Private AC car",
  "Driver cum guide (English speaking)",
  "Fuel & parking fees",
  "Mineral water",
  "Hotel pickup & drop-off (covered zone)",
];
const INCLUDED_ID = [
  "Mobil AC private",
  "Driver cum guide (berbahasa Inggris)",
  "BBM & biaya parkir",
  "Air mineral",
  "Antar-jemput hotel (zona terjangkau)",
];
const NOT_INCLUDED_EN = [
  "Entrance tickets",
  "Meals & drinks",
  "Personal expenses",
  "Tips for driver",
  "Overtime beyond package hours",
];
const NOT_INCLUDED_ID = [
  "Tiket masuk objek wisata",
  "Makan & minum",
  "Pengeluaran pribadi",
  "Tips driver",
  "Overtime di luar jam paket",
];
const REQUIREMENTS_EN = ["Comfortable walking shoes", "Sunscreen & hat"];
const REQUIREMENTS_ID = ["Sepatu jalan yang nyaman", "Tabir surya & topi"];
const TREK_REQUIREMENTS_EN = ["Warm jacket", "Comfortable trekking shoes", "Headlamp (provided)"];
const TREK_REQUIREMENTS_ID = ["Jaket hangat", "Sepatu trekking yang nyaman", "Senter kepala (disediakan)"];

/** One itinerary stop, bilingual. */
function stop(time: string, activity: string, activityId: string) {
  return { time, activity, activityId };
}

// ---------- the five Bali tours ----------
type TourSpec = {
  slug: string;
  title: string;
  titleId: string;
  description: string;
  descriptionId: string;
  /** Destination place name (kind "destination"). */
  destination: string;
  tone: string;
  ribbon?: string;
  ribbonId?: string;
  /** Join-in departure start time ("HH:MM"). */
  startTime: string;
  /** Private per-unit price (USD cents), 5500–9000. */
  privateUsdCents: number;
  extraHourUsdCents: number;
  /** Join-in adult price (USD cents), 3500–7500. */
  adultUsdCents: number;
  requirementsEn?: string[];
  requirementsId?: string[];
  itinerary: TourItineraryDay[];
};

const TOURS: TourSpec[] = [
  {
    slug: "ubud-kintamani-tour",
    title: "Ubud & Kintamani Tour",
    titleId: "Tur Ubud & Kintamani",
    description:
      "A full-day Bali classic: the Tegallalang rice terraces, Ubud Monkey Forest, and a Kintamani viewpoint overlooking Mount Batur and its lake.",
    descriptionId:
      "Tur seharian klasik Bali: terasering Tegallalang, Monkey Forest Ubud, dan viewpoint Kintamani dengan pemandangan Gunung Batur dan danau.",
    destination: "Ubud",
    tone: "from-emerald-400 to-teal-600",
    ribbon: "Best seller",
    ribbonId: "Terlaris",
    startTime: "08:00",
    privateUsdCents: 6500,
    extraHourUsdCents: 600,
    adultUsdCents: 4500,
    itinerary: [
      {
        day: 1,
        title: "Ubud & Kintamani",
        titleId: "Ubud & Kintamani",
        items: [
          stop("08:00", "Hotel pickup (covered zone)", "Penjemputan di hotel (zona terjangkau)"),
          stop("09:00", "Tegallalang rice terrace walk", "Jalan santai di terasering Tegallalang"),
          stop("10:30", "Ubud Monkey Forest", "Monkey Forest Ubud"),
          stop("12:00", "Lunch in Ubud", "Makan siang di Ubud"),
          stop("13:30", "Kintamani viewpoint — Mount Batur & lake", "Viewpoint Kintamani — Gunung Batur & danau"),
          stop("15:00", "Coffee & Luwak tasting at a plantation", "Cicip kopi & Luwak di perkebunan"),
          stop("16:30", "Return towards the hotel", "Perjalanan kembali ke hotel"),
          stop("18:00", "Hotel drop-off", "Antar kembali ke hotel"),
        ],
      },
    ],
  },
  {
    slug: "tanah-lot-uluwatu-tour",
    title: "Tanah Lot & Uluwatu Tour",
    titleId: "Tur Tanah Lot & Uluwatu",
    description:
      "West Bali's icons in one day: the sea temple of Tanah Lot, the clifftop Uluwatu temple, and Padang Padang beach.",
    descriptionId:
      "Ikon Bali Barat dalam sehari: pura laut Tanah Lot, pura di tebing Uluwatu, dan pantai Padang Padang.",
    destination: "Tanah Lot",
    tone: "from-amber-300 to-orange-500",
    startTime: "08:00",
    privateUsdCents: 6000,
    extraHourUsdCents: 500,
    adultUsdCents: 4000,
    itinerary: [
      {
        day: 1,
        title: "Temples & cliffs",
        titleId: "Pura & tebing",
        items: [
          stop("08:00", "Hotel pickup (covered zone)", "Penjemputan di hotel (zona terjangkau)"),
          stop("09:30", "Tanah Lot sea temple", "Pura laut Tanah Lot"),
          stop("11:30", "Lunch at a local warung", "Makan siang di warung lokal"),
          stop("13:00", "Uluwatu clifftop temple", "Pura Uluwatu di atas tebing"),
          stop("15:00", "Padang Padang beach", "Pantai Padang Padang"),
          stop("16:30", "Jimbaran Bay viewpoint", "Viewpoint Teluk Jimbaran"),
          stop("18:00", "Hotel drop-off", "Antar kembali ke hotel"),
        ],
      },
    ],
  },
  {
    slug: "nusa-penida-day-trip",
    title: "Nusa Penida Day Trip",
    titleId: "Tur Sehari Nusa Penida",
    description:
      "Fast boat from Sanur to Nusa Penida's west coast: Kelingking Beach, Angel's Billabong, Broken Beach, and Crystal Bay.",
    descriptionId:
      "Fast boat dari Sanur ke pesisir barat Nusa Penida: Kelingking Beach, Angel's Billabong, Broken Beach, dan Crystal Bay.",
    destination: "Nusa Penida",
    tone: "from-cyan-400 to-blue-600",
    ribbon: "Popular",
    ribbonId: "Populer",
    startTime: "08:00",
    privateUsdCents: 8500,
    extraHourUsdCents: 800,
    adultUsdCents: 7500,
    itinerary: [
      {
        day: 1,
        title: "West Nusa Penida",
        titleId: "Nusa Penida Barat",
        items: [
          stop("07:00", "Hotel pickup & transfer to Sanur", "Penjemputan hotel & transfer ke Sanur"),
          stop("08:00", "Fast boat to Nusa Penida", "Fast boat ke Nusa Penida"),
          stop("09:00", "Angel's Billabong & Broken Beach", "Angel's Billabong & Broken Beach"),
          stop("11:00", "Kelingking Beach viewpoint", "Viewpoint Kelingking Beach"),
          stop("12:30", "Lunch at a local warung", "Makan siang di warung lokal"),
          stop("14:00", "Crystal Bay — swim & snorkel", "Crystal Bay — berenang & snorkeling"),
          stop("16:00", "Fast boat back to Sanur", "Fast boat kembali ke Sanur"),
          stop("18:00", "Hotel drop-off", "Antar kembali ke hotel"),
        ],
      },
    ],
  },
  {
    slug: "bedugul-ulun-danu-tour",
    title: "Bedugul & Ulun Danu Tour",
    titleId: "Tur Bedugul & Ulun Danu",
    description:
      "Into Bali's cool highlands: the lake temple of Ulun Danu Beratan, the Handara gate, and the Wanagiri hills.",
    descriptionId:
      "Menuju dataran tinggi Bali yang sejuk: pura danau Ulun Danu Beratan, gerbang Handara, dan perbukitan Wanagiri.",
    destination: "Bedugul",
    tone: "from-lime-400 to-emerald-600",
    startTime: "08:00",
    privateUsdCents: 6500,
    extraHourUsdCents: 600,
    adultUsdCents: 4500,
    itinerary: [
      {
        day: 1,
        title: "Highlands & lake temple",
        titleId: "Dataran tinggi & pura danau",
        items: [
          stop("08:00", "Hotel pickup (covered zone)", "Penjemputan di hotel (zona terjangkau)"),
          stop("09:30", "Taman Ayun royal temple", "Pura kerajaan Taman Ayun"),
          stop("11:00", "Ulun Danu Beratan lake temple", "Pura danau Ulun Danu Beratan"),
          stop("12:30", "Lunch overlooking Lake Beratan", "Makan siang dengan pemandangan Danau Beratan"),
          stop("14:00", "Handara gate & Wanagiri hills", "Gerbang Handara & perbukitan Wanagiri"),
          stop("15:30", "Strawberry picking at a Bedugul farm", "Petik stroberi di kebun Bedugul"),
          stop("18:00", "Hotel drop-off", "Antar kembali ke hotel"),
        ],
      },
    ],
  },
  {
    slug: "batur-sunrise-trek",
    title: "Mount Batur Sunrise Trek",
    titleId: "Trek Sunrise Gunung Batur",
    description:
      "A pre-dawn trek to the 1,717 m summit of Mount Batur for sunrise above the clouds, then a volcanic hot-spring soak.",
    descriptionId:
      "Trek dini hari ke puncak Gunung Batur (1.717 m) untuk sunrise di atas awan, lalu berendam di pemandian air panas vulkanik.",
    destination: "Gunung Batur",
    tone: "from-indigo-400 to-violet-600",
    startTime: "03:30",
    privateUsdCents: 7500,
    extraHourUsdCents: 700,
    adultUsdCents: 5500,
    requirementsEn: TREK_REQUIREMENTS_EN,
    requirementsId: TREK_REQUIREMENTS_ID,
    itinerary: [
      {
        day: 1,
        title: "Sunrise trek",
        titleId: "Trek sunrise",
        items: [
          stop("03:30", "Hotel pickup", "Penjemputan di hotel"),
          stop("04:30", "Trek start at Pura Jati (2 hours up)", "Mulai trek di Pura Jati (2 jam naik)"),
          stop("06:00", "Sunrise at the summit (1,717 m)", "Sunrise di puncak (1.717 m)"),
          stop("07:30", "Breakfast cooked by volcanic steam", "Sarapan dimasak dengan uap vulkanik"),
          stop("08:30", "Descend to the base", "Turun ke kaki gunung"),
          stop("10:00", "Toya Bungkah natural hot springs", "Pemandian air panas alami Toya Bungkah"),
          stop("11:30", "Lunch with a Kintamani view", "Makan siang dengan pemandangan Kintamani"),
          stop("13:30", "Hotel drop-off", "Antar kembali ke hotel"),
        ],
      },
    ],
  },
];

// ---------- line + service type ----------
async function ensureTourLine(): Promise<string> {
  const existing = await db.orm.public.ServiceLine
    .select("id")
    .where({ slug: "tour-package" })
    .first();
  if (existing) {
    bump("ServiceLine", false);
    return existing.id;
  }
  const created = await db.orm.public.ServiceLine.create({
    id: crypto.randomUUID(),
    slug: "tour-package",
    label: "Tour Package",
    short: "Tour",
    tone: "from-amber-300 to-orange-500",
    sortOrder: 3,
  });
  bump("ServiceLine", true);
  return created.id;
}

/** The destination parent type of the Bali tours (seed.mts convention). */
async function ensureBaliType(lineId: string): Promise<string> {
  const existing = await db.orm.public.ServiceType
    .select("id")
    .where({ lineId, slug: "bali" })
    .first();
  if (existing) {
    bump("ServiceType", false);
    return existing.id;
  }
  const created = await db.orm.public.ServiceType.create({
    id: crypto.randomUUID(),
    lineId,
    slug: "bali",
    name: "Bali",
    sortOrder: 0,
  });
  bump("ServiceType", true);
  return created.id;
}

// ---------- destination places ----------
/**
 * Ensure the Bali destination rows exist. Ubud, Nusa Penida, Tanah Lot and
 * Pura Uluwatu come from scripts/seed.mts and are reused as-is; Kintamani,
 * Bedugul and Gunung Batur are added under their kabupaten (created when
 * missing, parents first — the seed.mts hierarchy pattern).
 */
async function ensureDestinations(): Promise<Map<string, string>> {
  const findPlace = async (kind: string, name: string) =>
    db.orm.public.Airport
      .select("id")
      .where((f) => f.kind.eq(kind))
      .where({ name })
      .first();

  const ensurePlace = async (
    kind: string,
    name: string,
    parentId: string | null,
    sortOrder: number,
  ): Promise<string> => {
    const existing = await findPlace(kind, name);
    if (existing) {
      bump("Airport", false);
      return existing.id;
    }
    const created = await db.orm.public.Airport.create({
      id: crypto.randomUUID(),
      kind,
      level: kind,
      iataCode: null,
      name,
      city: name,
      country: "Indonesia",
      parentId,
      sortOrder,
    });
    bump("Airport", true);
    return created.id;
  };

  // Parents of the new destinations (the province already exists in seed.mts).
  const baliProvince = await findPlace("province", "Bali");
  const bangli = await ensurePlace("city", "Kab. Bangli", baliProvince?.id ?? null, 5);
  const tabanan = await ensurePlace("city", "Kab. Tabanan", baliProvince?.id ?? null, 6);

  const ids = new Map<string, string>();
  // Reuse the seed.mts destinations where they exist.
  for (const name of ["Ubud", "Nusa Penida", "Tanah Lot", "Pura Uluwatu"]) {
    const row = await findPlace("destination", name);
    if (row) {
      ids.set(name, row.id);
      bump("Airport", false);
    }
  }
  ids.set("Kintamani", await ensurePlace("destination", "Kintamani", bangli, 10));
  ids.set("Bedugul", await ensurePlace("destination", "Bedugul", tabanan, 10));
  ids.set("Gunung Batur", await ensurePlace("destination", "Gunung Batur", bangli, 11));

  // Fallbacks — a destination the base seed has not created yet.
  for (const spec of TOURS) {
    if (!ids.has(spec.destination)) {
      ids.set(spec.destination, await ensurePlace("destination", spec.destination, baliProvince?.id ?? null, 20));
    }
  }
  return ids;
}

// ---------- products ----------
async function seedTourProducts(
  lineId: string,
  typeId: string,
  destinations: Map<string, string>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const tour of TOURS) {
    const destinationId = destinations.get(tour.destination) ?? null;
    const requirementsEn = tour.requirementsEn ?? REQUIREMENTS_EN;
    const requirementsId = tour.requirementsId ?? REQUIREMENTS_ID;

    // One product per kind — cleaner quotas than mixing kinds in one product.
    const variants: {
      slug: string;
      tourKind: "private" | "join_in";
      title: string;
      titleId: string;
      minPax: number;
      maxPax: number;
      fromPriceUsdCents: number;
    }[] = [
      {
        slug: tour.slug,
        tourKind: "private",
        title: `${tour.title} (Private)`,
        titleId: `${tour.titleId} (Private)`,
        minPax: 1,
        maxPax: 6,
        fromPriceUsdCents: tour.privateUsdCents,
      },
      {
        slug: `${tour.slug}-join-in`,
        tourKind: "join_in",
        title: `${tour.title} (Join-in)`,
        titleId: `${tour.titleId} (Join-in)`,
        minPax: 2,
        maxPax: 12,
        fromPriceUsdCents: tour.adultUsdCents,
      },
    ];

    for (const variant of variants) {
      const existing = await db.orm.public.Product
        .select("id")
        .where({ slug: variant.slug })
        .first();
      if (existing) {
        ids.set(variant.slug, existing.id);
        bump("Product", false);
        continue;
      }
      const created = await db.orm.public.Product.create({
        id: crypto.randomUUID(),
        slug: variant.slug,
        lineId,
        serviceTypeId: typeId,
        title: variant.title,
        titleId: variant.titleId,
        description: tour.description,
        descriptionId: tour.descriptionId,
        direction: "both",
        leadTimeDays: 1,
        tourKind: variant.tourKind,
        durationDays: 0,
        minPax: variant.minPax,
        maxPax: variant.maxPax,
        destinationId,
        itinerary: tour.itinerary as unknown as [],
        included: INCLUDED_EN as unknown as [],
        includedId: INCLUDED_ID as unknown as [],
        notIncluded: NOT_INCLUDED_EN as unknown as [],
        notIncludedId: NOT_INCLUDED_ID as unknown as [],
        requirements: requirementsEn as unknown as [],
        requirementsId: requirementsId as unknown as [],
        durationLabel: "10 hours",
        durationLabelId: "10 jam",
        tone: tour.tone,
        ribbon: tour.ribbon ?? null,
        ribbonId: tour.ribbonId ?? null,
        fromPriceUsdCents: variant.fromPriceUsdCents,
        imageUrl: null,
      });
      ids.set(variant.slug, created.id);
      bump("Product", true);
    }
  }
  return ids;
}

// ---------- packages ----------
async function seedTourPackages(productIds: Map<string, string>) {
  async function upsertPkg(args: {
    productId: string;
    label: string;
    labelId: string;
    unitKind: "per_pax" | "per_unit";
    adultUsdCents?: number;
    childUsdCents?: number;
    infantUsdCents?: number;
    unitUsdCents?: number;
    durationHours?: number;
    extraHourUsdCents?: number;
    description: string;
    descriptionId: string;
    info?: { key: string; name: string; excluded?: boolean }[];
  }) {
    const existing = await db.orm.public.ProductPackage
      .select("id")
      .where({ productId: args.productId, label: args.label })
      .first();
    if (existing) {
      bump("ProductPackage", false);
      return;
    }
    await db.orm.public.ProductPackage.create({
      id: crypto.randomUUID(),
      productId: args.productId,
      label: args.label,
      labelId: args.labelId,
      unitKind: args.unitKind,
      adultUsdCents: args.adultUsdCents ?? null,
      childUsdCents: args.childUsdCents ?? null,
      infantUsdCents: args.infantUsdCents ?? null,
      unitUsdCents: args.unitUsdCents ?? null,
      durationHours: args.durationHours ?? null,
      extraHourUsdCents: args.extraHourUsdCents ?? null,
      description: args.description,
      descriptionId: args.descriptionId,
      info: (args.info ?? []) as unknown as [],
      sortOrder: 0,
    });
    bump("ProductPackage", true);
  }

  for (const tour of TOURS) {
    const privateId = productIds.get(tour.slug);
    const joinInId = productIds.get(`${tour.slug}-join-in`);

    if (privateId) {
      await upsertPkg({
        productId: privateId,
        label: "Private Car (max 6 pax)",
        labelId: "Mobil Private (maks 6 pax)",
        unitKind: "per_unit",
        unitUsdCents: tour.privateUsdCents,
        durationHours: 10,
        extraHourUsdCents: tour.extraHourUsdCents,
        description:
          "Private AC car with an English-speaking driver cum guide for up to 6 passengers. Flexible start time within the covered zone.",
        descriptionId:
          "Mobil AC private dengan driver cum guide berbahasa Inggris untuk maksimal 6 penumpang. Waktu mulai fleksibel dalam zona terjangkau.",
        info: [
          { key: "fuel", name: "BBM termasuk" },
          { key: "driver_meal", name: "Makan driver", excluded: true },
        ],
      });
    }

    if (joinInId) {
      await upsertPkg({
        productId: joinInId,
        label: "Standard",
        labelId: "Standar",
        unitKind: "per_pax",
        adultUsdCents: tour.adultUsdCents,
        childUsdCents: Math.round(tour.adultUsdCents * 0.75),
        infantUsdCents: 0,
        description:
          "Shared transport on a scheduled departure. Price per person; child rate for ages 3–11, infants free.",
        descriptionId:
          "Transport bersama sesuai jadwal keberangkatan. Harga per orang; tarif anak untuk usia 3–11, bayi gratis.",
      });
    }
  }
}

// ---------- departures ----------
/** Daily open join-in departures for the next 30 days, quota 12. */
async function seedDepartures(productIds: Map<string, string>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const tour of TOURS) {
    const productId = productIds.get(`${tour.slug}-join-in`);
    if (!productId) continue;

    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);

      const existing = await db.orm.public.TourDeparture
        .select("id")
        .where({ productId, date, startTime: tour.startTime })
        .first();
      if (existing) {
        bump("TourDeparture", false);
        continue;
      }
      await db.orm.public.TourDeparture.create({
        id: crypto.randomUUID(),
        productId,
        date,
        startTime: tour.startTime,
        quota: 12,
        status: "open",
      });
      bump("TourDeparture", true);
    }
  }
}

// ---------- roster ----------
async function seedRoster() {
  const drivers = [
    { name: "Wayan Sudarta", phone: "6281234567801", notes: "Senior driver cum guide, 12 tahun pengalaman." },
    { name: "Made Wirawan", phone: "6281234567802", notes: "Spesialis rute Ubud & Kintamani." },
    { name: "Ketut Arya", phone: "6281234567803", notes: "Guide trek Gunung Batur berlisensi." },
  ];
  for (let i = 0; i < drivers.length; i++) {
    const d = drivers[i]!;
    const existing = await db.orm.public.Driver.select("id").where({ phone: d.phone }).first();
    if (existing) {
      bump("Driver", false);
      continue;
    }
    await db.orm.public.Driver.create({
      id: crypto.randomUUID(),
      name: d.name,
      phone: d.phone,
      languages: "ID, EN",
      notes: d.notes,
      active: true,
      sortOrder: i,
    });
    bump("Driver", true);
  }

  const vehicles = [
    { name: "Toyota Avanza", plateNumber: "DK 1842 DA", seats: 6 },
    { name: "Toyota Innova Reborn", plateNumber: "DK 2107 DW", seats: 7 },
    { name: "Toyota Hiace Premio", plateNumber: "DK 7615 DU", seats: 14 },
  ];
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i]!;
    const existing = await db.orm.public.Vehicle.select("id").where({ name: v.name }).first();
    if (existing) {
      bump("Vehicle", false);
      continue;
    }
    await db.orm.public.Vehicle.create({
      id: crypto.randomUUID(),
      name: v.name,
      plateNumber: v.plateNumber,
      seats: v.seats,
      active: true,
      sortOrder: i,
    });
    bump("Vehicle", true);
  }
}

// ---------- main ----------
async function main() {
  console.log("Seeding Bali tour operation…");
  const lineId = await ensureTourLine();
  const typeId = await ensureBaliType(lineId);
  const destinations = await ensureDestinations();
  const productIds = await seedTourProducts(lineId, typeId, destinations);
  await seedTourPackages(productIds);
  await seedDepartures(productIds);
  await seedRoster();

  console.log("\nCounts (table → created / already-present):");
  for (const [table, c] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(18)} +${c.created}   (had ${c.existing})`);
  }
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.close();
  });

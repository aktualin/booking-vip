"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getAdminReferenceData,
  getProductRelations,
  listProducts,
} from "@/app/actions/admin";
import { getTourAdminReferenceData } from "@/app/actions/admin-tour";
import { saveAdminEntity } from "@/app/actions/admin-crud";
import type { AdminProductRow, AdminReferenceData } from "@/types/admin";
import type { TourItineraryDay } from "@/types/tour";
import Field from "@/components/admin/Field";
import FieldControl, { type FieldSpec, type FieldValues } from "@/components/admin/fields";
import { ChevronLeft } from "@/components/icons";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";
import { useAdminRow, useAdminValue } from "@/components/admin/useAdminList";

const LIST_PATH = "/admin/catalog/products";

const getKey = (row: AdminProductRow) => row.id;

/** The standard Bali tour inclusion / exclusion lists (EN + ID). */
const BALI_TEMPLATE = {
  included: [
    "Private AC car",
    "Driver cum guide (English speaking)",
    "Fuel & parking fees",
    "Mineral water",
    "Hotel pickup & drop-off (covered zone)",
  ],
  includedId: [
    "Mobil AC private",
    "Driver cum guide (berbahasa Inggris)",
    "BBM & biaya parkir",
    "Air mineral",
    "Antar-jemput hotel (zona terjangkau)",
  ],
  notIncluded: [
    "Entrance tickets",
    "Meals & drinks",
    "Personal expenses",
    "Tips for driver",
    "Overtime beyond package hours",
  ],
  notIncludedId: [
    "Tiket masuk objek wisata",
    "Makan & minum",
    "Pengeluaran pribadi",
    "Tips driver",
    "Overtime di luar jam paket",
  ],
};

/** Multi-day itinerary templates — each fills both itinerary AND durationDays. */
const ITINERARY_TEMPLATES: Record<string, { days: TourItineraryDay[]; durationDays: number }> = {
  "1d": {
    durationDays: 0,
    days: [
      {
        day: 1,
        title: "Full Day Tour",
        titleId: "Tur Sehari Penuh",
        items: [
          { time: "08:00", activity: "Hotel pickup", activityId: "Penjemputan hotel" },
          { time: "09:00", activity: "Morning sightseeing", activityId: "Wisata pagi" },
          { time: "12:00", activity: "Lunch break", activityId: "Istirahat makan siang" },
          { time: "13:00", activity: "Afternoon activities", activityId: "Aktivitas sore" },
          { time: "16:00", activity: "Final stops", activityId: "Perhentian terakhir" },
          { time: "17:30", activity: "Return to hotel", activityId: "Kembali ke hotel" },
          { time: "18:00", activity: "Drop-off", activityId: "Antar kembali" },
        ],
      },
    ],
  },
  "2d1n": {
    durationDays: 2,
    days: [
      {
        day: 1,
        title: "Arrival & Exploration",
        titleId: "Kedatangan & Eksplorasi",
        items: [
          { time: "08:00", activity: "Hotel pickup", activityId: "Penjemputan hotel" },
          { time: "09:30", activity: "Morning sightseeing", activityId: "Wisata pagi" },
          { time: "12:00", activity: "Lunch", activityId: "Makan siang" },
          { time: "13:30", activity: "Afternoon activities", activityId: "Aktivitas sore" },
          { time: "17:00", activity: "Check-in hotel", activityId: "Check-in hotel" },
          { time: "19:00", activity: "Dinner recommendation", activityId: "Rekomendasi makan malam" },
        ],
      },
      {
        day: 2,
        title: "Main Tour & Departure",
        titleId: "Tur Utama & Kepulangan",
        items: [
          { time: "07:00", activity: "Breakfast", activityId: "Sarapan" },
          { time: "08:00", activity: "Main attractions", activityId: "Objek wisata utama" },
          { time: "12:00", activity: "Lunch", activityId: "Makan siang" },
          { time: "13:30", activity: "Final stops", activityId: "Perhentian terakhir" },
          { time: "16:00", activity: "Return to hotel", activityId: "Kembali ke hotel" },
          { time: "18:00", activity: "Drop-off", activityId: "Antar kembali" },
        ],
      },
    ],
  },
  "3d2n": {
    durationDays: 3,
    days: [
      {
        day: 1,
        title: "Arrival & Exploration",
        titleId: "Kedatangan & Eksplorasi",
        items: [
          { time: "08:00", activity: "Hotel pickup", activityId: "Penjemputan hotel" },
          { time: "09:30", activity: "Morning sightseeing", activityId: "Wisata pagi" },
          { time: "12:00", activity: "Lunch", activityId: "Makan siang" },
          { time: "13:30", activity: "Afternoon activities", activityId: "Aktivitas sore" },
          { time: "17:00", activity: "Check-in hotel", activityId: "Check-in hotel" },
          { time: "19:00", activity: "Dinner recommendation", activityId: "Rekomendasi makan malam" },
        ],
      },
      {
        day: 2,
        title: "Full Day Tour",
        titleId: "Tur Sehari Penuh",
        items: [
          { time: "07:00", activity: "Breakfast", activityId: "Sarapan" },
          { time: "08:00", activity: "Main attractions", activityId: "Objek wisata utama" },
          { time: "12:00", activity: "Lunch", activityId: "Makan siang" },
          { time: "13:30", activity: "Cultural experiences", activityId: "Pengalaman budaya" },
          { time: "16:00", activity: "Scenic viewpoints", activityId: "Pemandangan alam" },
          { time: "18:00", activity: "Return to hotel", activityId: "Kembali ke hotel" },
          { time: "19:30", activity: "Dinner", activityId: "Makan malam" },
        ],
      },
      {
        day: 3,
        title: "Departure Day",
        titleId: "Hari Kepulangan",
        items: [
          { time: "07:00", activity: "Breakfast", activityId: "Sarapan" },
          { time: "08:00", activity: "Last-minute shopping", activityId: "Belanja terakhir" },
          { time: "10:00", activity: "Souvenir stop", activityId: "Toko oleh-oleh" },
          { time: "12:00", activity: "Lunch", activityId: "Makan siang" },
          { time: "14:00", activity: "Airport transfer", activityId: "Transfer bandara" },
          { time: "16:00", activity: "Drop-off", activityId: "Antar kembali" },
        ],
      },
    ],
  },
};

/**
 * The product form — shared by the create page and the edit page.
 *
 * The reference data (service lines, service types, places, amenities) and
 * the join rows (amenities, add-ons) are loaded through server actions, so
 * the page shell stays static.
 *
 * Products of the tour-package line get an extra "Tour" section: kind,
 * pax limits, destination, the day-by-day itinerary editor and the Bali
 * template button. The form owns its values state (instead of delegating to
 * EntityFormPage) because the itinerary editor and the template button write
 * several fields at once.
 */
export default function ProductsForm({
  mode,
  id,
}: {
  mode: "create" | "edit";
  id?: string;
}) {
  const load = useCallback(() => listProducts(), []);
  const { row, loading: rowLoading, error: rowError, missing } = useAdminRow<AdminProductRow>(
    id,
    load,
    getKey
  );

  const reference = useCallback(() => getAdminReferenceData(), []);
  const { data: refs, loading: refsLoading } = useAdminValue<AdminReferenceData>(reference);

  const tourReference = useCallback(() => getTourAdminReferenceData(), []);
  const { data: tourRefs, loading: tourRefsLoading } = useAdminValue(tourReference);

  const relationsLoad = useCallback(async () => {
    if (!id) return null;
    return getProductRelations({ productId: id });
  }, [id]);
  const { data: relations, loading: relationsLoading } = useAdminValue(relationsLoad);

  const loading = rowLoading || refsLoading || tourRefsLoading || relationsLoading;

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--admin-line)] px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]">
        Memuat data…
      </div>
    );
  }

  if (missing) {
    return (
      <div className="rounded-lg border border-[var(--admin-line)] px-6 py-12 text-center">
        <p className="text-[13px] font-medium">Data tidak ditemukan</p>
        <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
          Record yang Anda buka sudah tidak ada di database.
        </p>
        <Link href={LIST_PATH} className={`${adminClass.buttonSecondary} mt-4`}>
          Kembali ke Produk
        </Link>
      </div>
    );
  }

  // The form body mounts once the data is there — the initial values are
  // then read exactly once (the EntityFormPage pattern).
  return (
    <ProductForm
      mode={mode}
      id={id}
      row={row}
      refs={refs}
      tourRefs={tourRefs}
      relations={relations}
      loadError={rowError}
    />
  );
}

/** The form body — mounted only when the data is loaded. */
function ProductForm({
  mode,
  id,
  row,
  refs,
  tourRefs,
  relations,
  loadError,
}: {
  mode: "create" | "edit";
  id?: string;
  row: AdminProductRow | null;
  refs: AdminReferenceData | null;
  tourRefs: { tourLineId: string | null; destinations: { value: string; label: string }[] } | null;
  relations: { amenityIds: string[]; addOnIds: string[] } | null;
  loadError?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<FieldValues>(() => ({
    title: row?.title ?? "",
    slug: row?.slug ?? "",
    lineId: row?.lineId ?? refs?.lines[0]?.value ?? "",
    serviceTypeId: row?.serviceTypeId ?? "",
    airportId: row?.airportId ?? "",
    direction: row?.direction ?? "both",
    fromPriceUsdCents: row?.fromPriceUsdCents ?? null,
    rating: row?.rating ?? null,
    reviews: row?.reviews ?? null,
    durationLabel: row?.durationLabel ?? "",
    durationLabelId: row?.durationLabelId ?? "",
    leadTimeHours: row?.leadTimeHours ?? 0,
    leadTimeDays: row?.leadTimeDays ?? 0,
    stockTotal: row?.stockTotal ?? 1,
    imageUrl: row?.imageUrl ?? "",
    ribbon: row?.ribbon ?? "",
    ribbonId: row?.ribbonId ?? "",
    tone: row?.tone ?? "from-sky-400 to-blue-600",
    description: row?.description ?? "",
    descriptionId: row?.descriptionId ?? "",
    titleId: row?.titleId ?? "",
    specs: row?.specs ?? [],
    included: row?.included ?? [],
    notIncluded: row?.notIncluded ?? [],
    requirements: row?.requirements ?? [],
    includedId: row?.includedId ?? [],
    notIncludedId: row?.notIncludedId ?? [],
    requirementsId: row?.requirementsId ?? [],
    amenityIds: relations?.amenityIds ?? [],
    addOnIds: relations?.addOnIds ?? [],
    isAddOn: row?.isAddOn ?? false,
    active: row?.active ?? true,
    // Tour fields.
    tourKind: row?.tourKind ?? "",
    durationDays: row?.durationDays ?? 0,
    minPax: row?.minPax ?? 1,
    maxPax: row?.maxPax ?? null,
    destinationId: row?.destinationId ?? "",
    itinerary: row?.itinerary ?? [],
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Bumped by the Bali template so the list editors remount with the new text. */
  const [templateNonce, setTemplateNonce] = useState(0);

  const tourLineId = tourRefs?.tourLineId ?? null;
  const isTour = tourLineId != null && values.lineId === tourLineId;

  const setValue = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  const applyBaliTemplate = () => {
    setValues((prev) => ({ ...prev, ...BALI_TEMPLATE }));
    setTemplateNonce((n) => n + 1);
    setTemplateMenuOpen(false);
    showAdminToast("Template Bali diterapkan ke daftar Termasuk / Tidak Termasuk (EN & ID).");
  };

  const applyItineraryTemplate = (key: string) => {
    const tpl = ITINERARY_TEMPLATES[key];
    if (!tpl) return;
    setValues((prev) => ({
      ...prev,
      itinerary: tpl.days,
      durationDays: tpl.durationDays,
    }));
    setTemplateNonce((n) => n + 1);
    setTemplateMenuOpen(false);
    const labels: Record<string, string> = {
      "1d": "Tur Sehari (10 jam)",
      "2d1n": "2 Hari 1 Malam",
      "3d2n": "3 Hari 2 Malam",
    };
    showAdminToast(`Template "${labels[key] ?? key}" diterapkan ke itinerary.`);
  };

  const fields = useMemo<FieldSpec[]>(
    () => [
      { name: "title", label: "Judul", kind: "text", wide: true },
      { name: "titleId", label: "Judul (ID)", kind: "text", wide: true, hint: "Kosongkan untuk memakai judul EN" },
      { name: "slug", label: "Slug", kind: "text", hint: "URL produk, harus unik" },
      { name: "lineId", label: "Service Line", kind: "select", options: refs?.lines ?? [] },
      {
        name: "serviceTypeId",
        label: "Tipe Layanan",
        kind: "select",
        options: refs?.serviceTypes ?? [],
      },
      { name: "airportId", label: "Place", kind: "select", options: refs?.places ?? [] },
      {
        name: "direction",
        label: "Arah",
        kind: "select",
        options: [
          { value: "both", label: "Both" },
          { value: "arrival", label: "Arrival" },
          { value: "departure", label: "Departure" },
        ],
      },
      { name: "fromPriceUsdCents", label: "Harga Mulai", kind: "money" },
      { name: "rating", label: "Rating", kind: "number" },
      { name: "reviews", label: "Jumlah Ulasan", kind: "number" },
      { name: "durationLabel", label: "Label Durasi", kind: "text", placeholder: "e.g. 10 hours" },
      { name: "durationLabelId", label: "Label Durasi (ID)", kind: "text", placeholder: "e.g. 10 jam" },
      { name: "leadTimeHours", label: "Lead Time (jam)", kind: "number" },
      { name: "leadTimeDays", label: "Lead Time (hari)", kind: "number" },
      {
        name: "stockTotal",
        label: "Stok Total (unit)",
        kind: "number",
        hint: "Jumlah unit yang dimiliki vendor. Stok tersedia dihitung otomatis dari booking aktif.",
      },
      { name: "imageUrl", label: "URL Gambar", kind: "text", wide: true },
      { name: "ribbon", label: "Ribbon", kind: "text" },
      { name: "ribbonId", label: "Ribbon (ID)", kind: "text" },
      { name: "tone", label: "Tone", kind: "text" },
      { name: "description", label: "Deskripsi", kind: "textarea", wide: true },
      { name: "descriptionId", label: "Deskripsi (ID)", kind: "textarea", wide: true },
      {
        name: "specs",
        label: "Spesifikasi (key/value)",
        kind: "keyvalue",
        wide: true,
        hint: "key = identitas stabil (luggage, passengers, electric, …), nama = teks tampilan",
      },
      { name: "included", label: "Termasuk", kind: "tags", wide: true },
      { name: "includedId", label: "Termasuk (ID)", kind: "tags", wide: true },
      { name: "notIncluded", label: "Tidak Termasuk", kind: "tags", wide: true },
      { name: "notIncludedId", label: "Tidak Termasuk (ID)", kind: "tags", wide: true },
      { name: "requirements", label: "Persyaratan", kind: "tags", wide: true },
      { name: "requirementsId", label: "Persyaratan (ID)", kind: "tags", wide: true },
      {
        name: "amenityIds",
        label: "Amenity",
        kind: "multiselect",
        options: refs?.amenities ?? [],
      },
      { name: "addOnIds", label: "Add-on", kind: "multiselect", options: refs?.addOns ?? [] },
      { name: "isAddOn", label: "Status Produk", kind: "toggle", hint: "Aktif sebagai add-on" },
      { name: "active", label: "Aktif", kind: "toggle" },
    ],
    [refs]
  );

  const tourFields = useMemo<FieldSpec[]>(
    () => [
      {
        name: "tourKind",
        label: "Jenis Tour",
        kind: "select",
        options: [
          { value: "private", label: "Private (per mobil)" },
          { value: "join_in", label: "Join-in (per pax)" },
        ],
        hint: "Private = tanggal fleksibel per mobil; Join-in = jadwal keberangkatan dengan kuota kursi",
      },
      {
        name: "destinationId",
        label: "Destinasi",
        kind: "select",
        options: tourRefs?.destinations ?? [],
        hint: "Place dengan kind destination",
      },
      { name: "durationDays", label: "Durasi (hari)", kind: "number", hint: "0 = tur sehari" },
      { name: "minPax", label: "Min Pax", kind: "number", hint: "Minimum peserta dewasa + anak" },
      { name: "maxPax", label: "Maks Pax", kind: "number", hint: "Kosongkan = tanpa batas" },
    ],
    [tourRefs]
  );

  const fieldId = (name: string) => `field-product-${id ?? "new"}-${name}`;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    setFieldErrors({});

    try {
      // Leaving the tour line clears the tour data — a non-tour product
      // never keeps a stale tourKind / itinerary.
      const payload = isTour
        ? values
        : {
            ...values,
            tourKind: null,
            durationDays: 0,
            minPax: 1,
            maxPax: null,
            destinationId: null,
            itinerary: [],
          };

      const result = await saveAdminEntity({ table: "product", id, values: payload });

      if (!result.ok) {
        setError(result.error);
        if (result.field) setFieldErrors({ [result.field]: result.error });
        return;
      }

      showAdminToast(result.message);
      router.push(LIST_PATH);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan data");
    } finally {
      setSaving(false);
    }
  };

  /** The list editors remount after the template so their text stays in sync. */
  const fieldKey = (name: string) =>
    name === "included" || name === "includedId" || name === "notIncluded" || name === "notIncludedId"
      ? `${name}-${templateNonce}`
      : name;

  return (
    <form onSubmit={handleSubmit} className="pb-6">
      <Link
        href={LIST_PATH}
        className="mb-4 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--admin-muted)] transition-colors hover:text-[var(--admin-ink)]"
      >
        <ChevronLeft width={14} height={14} />
        Kembali ke Produk
      </Link>

      <div className="mb-5">
        <h1 className={adminClass.h1}>{mode === "edit" ? "Edit Produk" : "Tambah Produk"}</h1>
        {row?.title ? (
          <p className="mt-1 break-all text-[13px] text-[var(--admin-muted)]">{row.title}</p>
        ) : null}
        <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
          Produk adalah item yang bisa dipesan pada service line tertentu.
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      {loadError ? (
        <p className="mb-4 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-danger">
          {loadError}
        </p>
      ) : null}

      <div className={`${adminClass.panel} p-5 sm:p-6`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <Field
              key={fieldKey(f.name)}
              label={f.label}
              hint={f.hint}
              wide={f.wide}
              htmlFor={fieldId(f.name)}
              error={fieldErrors[f.name]}
            >
              <FieldControl
                spec={f}
                id={fieldId(f.name)}
                value={values[f.name]}
                onChange={(v) => setValue(f.name, v)}
              />
            </Field>
          ))}
        </div>

        {isTour ? (
          <div className="mt-6 border-t border-[var(--admin-line)] pt-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Tour</h2>
              <div className="relative" ref={templateMenuRef}>
                <button
                  type="button"
                  onClick={() => setTemplateMenuOpen((v) => !v)}
                  className={adminClass.buttonSecondary}
                  title="Pilih template untuk mengisi itinerary atau daftar termasuk/tidak termasuk"
                >
                  📋 Template ▾
                </button>
                {templateMenuOpen ? (
                  <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-[var(--admin-line)] bg-white py-1 shadow-lg">
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--admin-muted)]">
                      Itinerary
                    </p>
                    <button
                      type="button"
                      onClick={() => applyItineraryTemplate("1d")}
                      className="block w-full px-3 py-2 text-left text-[12px] hover:bg-[var(--admin-hover)]"
                    >
                      Tur Sehari (10 jam)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyItineraryTemplate("2d1n")}
                      className="block w-full px-3 py-2 text-left text-[12px] hover:bg-[var(--admin-hover)]"
                    >
                      2 Hari 1 Malam
                    </button>
                    <button
                      type="button"
                      onClick={() => applyItineraryTemplate("3d2n")}
                      className="block w-full px-3 py-2 text-left text-[12px] hover:bg-[var(--admin-hover)]"
                    >
                      3 Hari 2 Malam
                    </button>
                    <div className="my-1 border-t border-[var(--admin-line)]" />
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--admin-muted)]">
                      Include / Exclude
                    </p>
                    <button
                      type="button"
                      onClick={applyBaliTemplate}
                      className="block w-full px-3 py-2 text-left text-[12px] hover:bg-[var(--admin-hover)]"
                    >
                      Template Bali (Termasuk / Tidak Termasuk)
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {tourFields.map((f) => (
                <Field
                  key={f.name}
                  label={f.label}
                  hint={f.hint}
                  wide={f.wide}
                  htmlFor={fieldId(f.name)}
                  error={fieldErrors[f.name]}
                >
                  <FieldControl
                    spec={f}
                    id={fieldId(f.name)}
                    value={values[f.name]}
                    onChange={(v) => setValue(f.name, v)}
                  />
                </Field>
              ))}
            </div>

            <div className="mt-5">
              <span className={`mb-1.5 block ${adminClass.label}`}>Itinerary</span>
              <ItineraryEditor
                value={(values.itinerary as TourItineraryDay[]) ?? []}
                onChange={(v) => setValue("itinerary", v)}
                durationDays={values.durationDays as number}
                onDurationChange={(d) => setValue("durationDays", d)}
              />
              {fieldErrors.itinerary ? (
                <span className="mt-1 block text-[11px] text-danger">{fieldErrors.itinerary}</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 z-40 mt-5 flex items-center justify-end gap-2 border-t border-[var(--admin-line)] bg-white py-3">
        <Link href={LIST_PATH} className={adminClass.buttonSecondary}>
          Batal
        </Link>
        <button type="submit" disabled={saving} className={adminClass.buttonPrimary}>
          {saving ? "Menyimpan…" : id ? "Simpan Perubahan" : "Simpan"}
        </button>
      </div>
    </form>
  );
}

/**
 * The day-by-day itinerary editor — a dynamic list of days, each with rows
 * of { time, activity, activityId }. Day numbers follow the list order.
 *
 * Supports:
 * - Adding / removing days (with confirmation when items exist)
 * - Item reorder within a day (up/down buttons)
 * - Collapsible day sections for long itineraries
 * - Auto-sync of durationDays when days change
 * - Duration hint display
 */
function ItineraryEditor({
  value,
  onChange,
  durationDays,
  onDurationChange,
}: {
  value: TourItineraryDay[];
  onChange: (value: TourItineraryDay[]) => void;
  durationDays: number;
  onDurationChange: (d: number) => void;
}) {
  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(new Set());

  const renumber = (days: TourItineraryDay[]): TourItineraryDay[] =>
    days.map((day, index) => ({ ...day, day: index + 1 }));

  /** Sync durationDays: days.length > 1 → days.length, else 0. */
  const syncDuration = (days: TourItineraryDay[]) => {
    const newDuration = days.length > 1 ? days.length : 0;
    if (newDuration !== durationDays) {
      onDurationChange(newDuration);
    }
  };

  const updateDays = (next: TourItineraryDay[]) => {
    const renumbered = renumber(next);
    onChange(renumbered);
    syncDuration(renumbered);
  };

  const updateDay = (index: number, patch: Partial<TourItineraryDay>) => {
    onChange(renumber(value.map((day, i) => (i === index ? { ...day, ...patch } : day))));
  };

  const updateItem = (
    dayIndex: number,
    itemIndex: number,
    patch: Partial<TourItineraryDay["items"][number]>,
  ) => {
    onChange(
      renumber(
        value.map((day, i) =>
          i === dayIndex
            ? {
                ...day,
                items: day.items.map((item, j) =>
                  j === itemIndex ? { ...item, ...patch } : item,
                ),
              }
            : day,
        ),
      ),
    );
  };

  const moveItem = (dayIndex: number, itemIndex: number, direction: -1 | 1) => {
    const day = value[dayIndex];
    const targetIndex = itemIndex + direction;
    if (targetIndex < 0 || targetIndex >= day.items.length) return;
    const newItems = [...day.items];
    [newItems[itemIndex], newItems[targetIndex]] = [newItems[targetIndex], newItems[itemIndex]];
    updateDay(dayIndex, { items: newItems });
  };

  const removeDay = (dayIndex: number) => {
    const day = value[dayIndex];
    if (day.items.length > 0 && day.items.some((it) => it.activity.trim() !== "")) {
      if (!window.confirm(`Hapus Hari ${dayIndex + 1}? Hari ini memiliki ${day.items.length} aktivitas.`)) {
        return;
      }
    }
    updateDays(value.filter((_, i) => i !== dayIndex));
  };

  const addDay = () => {
    updateDays([
      ...value,
      { day: value.length + 1, title: "", titleId: "", items: [{ time: "", activity: "" }] },
    ]);
  };

  const toggleCollapse = (dayIndex: number) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayIndex)) next.delete(dayIndex);
      else next.add(dayIndex);
      return next;
    });
  };

  // Duration hint
  const durationHint =
    value.length > 1
      ? `Durasi otomatis: ${value.length} hari ${value.length - 1} malam`
      : value.length === 1
        ? "Tur sehari (tanpa menginap)"
        : "Belum ada hari";

  return (
    <div className="space-y-3">
      {/* Duration hint */}
      <div className="flex items-center gap-2 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2">
        <span className="text-[12px] font-semibold text-[var(--admin-ink)]">⏱️</span>
        <span className="text-[12px] text-[var(--admin-ink)]">{durationHint}</span>
      </div>

      {value.length === 0 ? (
        <p className="text-[12px] text-[var(--admin-muted)]">
          Belum ada hari — tambahkan hari pertama atau pilih template di atas.
        </p>
      ) : null}

      {value.map((day, dayIndex) => {
        const isCollapsed = collapsedDays.has(dayIndex);
        return (
          <div
            key={dayIndex}
            className="overflow-hidden rounded-lg border border-[var(--admin-line)] transition-all"
          >
            {/* Day header — always visible, clickable to collapse */}
            <div
              className="flex cursor-pointer select-none items-center gap-2 bg-[var(--admin-hover)] px-3 py-2"
              onClick={() => toggleCollapse(dayIndex)}
            >
              <span className="text-[11px] text-[var(--admin-muted)]">
                {isCollapsed ? "▶" : "▼"}
              </span>
              <span className={`${adminClass.label} shrink-0`}>Hari {dayIndex + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--admin-ink)]">
                {day.title || "(tanpa judul)"}
              </span>
              <span className="shrink-0 text-[11px] text-[var(--admin-muted)]">
                {day.items.length} item
              </span>
            </div>

            {/* Day body — collapsible */}
            {!isCollapsed ? (
              <div className="p-3">
                {/* Title inputs */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={day.title}
                    placeholder="Day title (EN)"
                    aria-label={`Judul hari ${dayIndex + 1} (EN)`}
                    onChange={(e) => updateDay(dayIndex, { title: e.target.value })}
                    className={`${adminClass.input} min-w-40 flex-1`}
                  />
                  <input
                    type="text"
                    value={day.titleId ?? ""}
                    placeholder="Judul hari (ID)"
                    aria-label={`Judul hari ${dayIndex + 1} (ID)`}
                    onChange={(e) => updateDay(dayIndex, { titleId: e.target.value })}
                    className={`${adminClass.input} min-w-40 flex-1`}
                  />
                  <button
                    type="button"
                    aria-label={`Hapus hari ${dayIndex + 1}`}
                    title="Hapus Hari"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDay(dayIndex);
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--admin-line)] text-[var(--admin-muted)] hover:bg-red-50 hover:text-danger"
                  >
                    ×
                  </button>
                </div>

                {/* Items */}
                <div className="space-y-2">
                  {day.items.length === 0 ? (
                    <p className="text-[11px] italic text-[var(--admin-muted)]">Belum ada aktivitas</p>
                  ) : null}
                  {day.items.map((item, itemIndex) => (
                    <div key={itemIndex} className="flex flex-wrap items-center gap-2">
                      {/* Reorder buttons */}
                      <div className="flex shrink-0 flex-col gap-0.5">
                        <button
                          type="button"
                          aria-label="Pindah ke atas"
                          disabled={itemIndex === 0}
                          onClick={() => moveItem(dayIndex, itemIndex, -1)}
                          className="flex h-5 w-6 items-center justify-center rounded text-[10px] text-[var(--admin-muted)] hover:bg-[var(--admin-hover)] disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label="Pindah ke bawah"
                          disabled={itemIndex === day.items.length - 1}
                          onClick={() => moveItem(dayIndex, itemIndex, 1)}
                          className="flex h-5 w-6 items-center justify-center rounded text-[10px] text-[var(--admin-muted)] hover:bg-[var(--admin-hover)] disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                      <input
                        type="time"
                        value={item.time}
                        aria-label={`Jam item ${itemIndex + 1} hari ${dayIndex + 1}`}
                        onChange={(e) => updateItem(dayIndex, itemIndex, { time: e.target.value })}
                        className={`${adminClass.input} w-28 shrink-0 tabular-nums`}
                      />
                      <input
                        type="text"
                        value={item.activity}
                        placeholder="Activity (EN)"
                        aria-label={`Aktivitas item ${itemIndex + 1} (EN)`}
                        onChange={(e) =>
                          updateItem(dayIndex, itemIndex, { activity: e.target.value })
                        }
                        className={`${adminClass.input} min-w-40 flex-1`}
                      />
                      <input
                        type="text"
                        value={item.activityId ?? ""}
                        placeholder="Aktivitas (ID)"
                        aria-label={`Aktivitas item ${itemIndex + 1} (ID)`}
                        onChange={(e) =>
                          updateItem(dayIndex, itemIndex, { activityId: e.target.value })
                        }
                        className={`${adminClass.input} min-w-40 flex-1`}
                      />
                      <button
                        type="button"
                        aria-label={`Hapus item ${itemIndex + 1}`}
                        onClick={() =>
                          updateDay(dayIndex, {
                            items: day.items.filter((_, j) => j !== itemIndex),
                          })
                        }
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--admin-line)] text-[var(--admin-muted)] hover:bg-[var(--admin-hover)]"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateDay(dayIndex, {
                        items: [...day.items, { time: "", activity: "" }],
                      })
                    }
                    className="inline-flex h-8 items-center rounded-lg border border-[var(--admin-line)] px-3 text-[12px] font-semibold text-[var(--admin-ink)] hover:bg-[var(--admin-hover)]"
                  >
                    + Tambah item
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addDay}
        className={adminClass.buttonSecondary}
      >
        + Tambah Hari
      </button>
    </div>
  );
}

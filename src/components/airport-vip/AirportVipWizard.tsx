"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createBooking, previewTaxes } from "@/app/actions/booking";
import { getPlaceOptions } from "@/app/actions/catalog";
import PaxStepper from "@/components/booking/PaxStepper";
import PlaceOptionList from "@/components/ui/PlaceOptionList";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { SearchIcon } from "@/components/icons";
import { placeLabel, type PlaceNode } from "@/lib/places";
import { useLocale } from "@/components/providers/LocaleProvider";
import { uploadPassportPhoto } from "@/lib/passport-upload";
import type { DictKey } from "@/i18n";
import {
  bookingRuleRows,
  resolveServiceSteps,
  type BookingRules,
  type ServiceInfoMap,
} from "@/lib/bookingRules";
import type {
  AirportOption,
  AirportServiceOption,
  AirlineOption,
  CountryOption,
} from "@/lib/airport-vip";
import type { TaxPreview } from "@/types";

type Props = {
  countries: CountryOption[];
  airports: AirportOption[];
  airlines: AirlineOption[];
  services: AirportServiceOption[];
  rules: BookingRules;
  /** The service steps and notes, keyed by IATA code plus "default". */
  serviceInfo: ServiceInfoMap;
};

type Step =
  | "country"
  | "airport"
  | "datetime"
  | "flight"
  | "service"
  | "passenger"
  | "confirm";

const STEPS: { key: Step; labelKey: DictKey }[] = [
  { key: "country", labelKey: "airportVip.step.country" },
  { key: "airport", labelKey: "airportVip.step.airport" },
  { key: "datetime", labelKey: "airportVip.step.datetime" },
  { key: "flight", labelKey: "airportVip.step.flight" },
  { key: "service", labelKey: "airportVip.step.service" },
  { key: "passenger", labelKey: "airportVip.step.passenger" },
  { key: "confirm", labelKey: "airportVip.step.confirm" },
];

const TIME_SLOTS = [
  "00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00",
  "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00",
  "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00",
];

/** The passport upload rules — mirrored from the server route. */
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** The next 90 days as `YYYY-MM-DD`. */
function upcomingDates(count: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 1; i <= count; i++) {
    dates.push(
      new Date(today.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    );
  }
  return dates;
}

/** One traveler's document form (passport data + photo upload state). */
type TravelerForm = {
  fullName: string;
  passportNumber: string;
  /** "" means "follow the country step selection". */
  nationality: string;
  /** `YYYY-MM-DD` */
  dateOfBirth: string;
  /** `YYYY-MM-DD` */
  passportExpiry: string;
  /** The private R2 key returned by the upload route ("" until uploaded). */
  photoKey: string;
  photoName: string;
  /** Local object-URL preview of an image upload (null for PDFs). */
  previewUrl: string | null;
  uploading: boolean;
  uploadError: string | null;
};

function emptyTraveler(): TravelerForm {
  return {
    fullName: "",
    passportNumber: "",
    nationality: "",
    dateOfBirth: "",
    passportExpiry: "",
    photoKey: "",
    photoName: "",
    previewUrl: null,
    uploading: false,
    uploadError: null,
  };
}

/** A label/value row of the confirmation summary. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] font-medium text-ink">{value}</dd>
    </div>
  );
}

/** The shared look of a form field label. */
const FIELD_LABEL = "mb-1.5 block text-[12px] font-medium text-ink";
/** The shared look of a text/date/select input. */
const FIELD_INPUT =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

/**
 * The airport VIP booking wizard.
 *
 * Seven steps — country, airport, date & time, flight, service, travelers,
 * confirm. The passenger step collects each traveler's passport data and a
 * privately-stored passport photo; the country step drives the Visa on
 * Arrival awareness. Prices come from the database (the lists are passed in
 * by the server component) and the hero search can prefill the first steps
 * through the URL query string.
 */
export default function AirportVipWizard({
  countries,
  airports,
  airlines,
  services,
  rules,
  serviceInfo,
}: Props) {
  const dates = useMemo(() => upcomingDates(90), []);
  const { t, lang, formatMoney } = useLocale();
  const dateLocale = lang === "id" ? "id-ID" : "en-GB";
  const searchParams = useSearchParams();

  /** Where the traveller is from — not where the airport is. */
  const [country, setCountry] = useState("");
  const [step, setStep] = useState<Step>("country");
  const [airportId, setAirportId] = useState("");
  const [direction, setDirection] = useState<"arrival" | "departure">("arrival");
  const [date, setDate] = useState(dates[0] ?? "");
  const [time, setTime] = useState("09:00");
  const [airlineCode, setAirlineCode] = useState("");
  const [flightCode, setFlightCode] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [adult, setAdult] = useState(1);
  const [child, setChild] = useState(0);
  const [leadName, setLeadName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  /** Add-on slug → quantity. Only entries with a quantity above 0 are kept. */
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});
  /** One document form per traveler (adults first, then children). */
  const [travelerForms, setTravelerForms] = useState<TravelerForm[]>([emptyTraveler()]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  /** A retry of the same submission reuses the key — no duplicate booking. */
  const idempotencyKeyRef = useRef<string | null>(null);

  // Prefill from the hero search query string (nationality, airport, date,
  // dateTime, paxAdults/paxChildren). Every param is optional — a bare
  // /airport-vip visit starts from clean state.
  useEffect(() => {
    const nationality = searchParams.get("nationality");
    if (nationality && countries.some((c) => c.name === nationality)) {
      setCountry(nationality);
    }

    const airportParam = searchParams.get("airport");
    if (airportParam) {
      const match = airports.find(
        (a) =>
          placeLabel({ kind: "airport", name: a.name, iataCode: a.iataCode }) === airportParam ||
          a.name === airportParam ||
          (a.iataCode !== null && a.iataCode === airportParam.toUpperCase()),
      );
      if (match) setAirportId(match.id);
    }

    const dateParam = searchParams.get("date");
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dates.includes(dateParam)) {
      setDate(dateParam);
    }
    const timeParam = searchParams.get("dateTime");
    if (timeParam && TIME_SLOTS.includes(timeParam)) {
      setTime(timeParam);
    }

    const adultsParam = Number(searchParams.get("paxAdults"));
    if (Number.isFinite(adultsParam) && adultsParam >= 1) {
      setAdult(Math.min(20, Math.floor(adultsParam)));
    }
    const childrenParam = Number(searchParams.get("paxChildren"));
    if (Number.isFinite(childrenParam) && childrenParam >= 1) {
      setChild(Math.min(10, Math.floor(childrenParam)));
    }
    // Run once on mount — the wizard owns the values from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The place hierarchy (region → country → province → city → airport) for
  // the grouped airport picker. The flat `airports` prop stays the fallback
  // when the hierarchy cannot be loaded.
  const [placeTree, setPlaceTree] = useState<PlaceNode[]>([]);
  const [airportQuery, setAirportQuery] = useState("");
  useEffect(() => {
    getPlaceOptions("airport").then(setPlaceTree);
  }, []);

  // Keep one document form per traveler. Growing appends clean forms;
  // shrinking drops the tail (and releases its preview URLs).
  const formsRef = useRef(travelerForms);
  formsRef.current = travelerForms;
  useEffect(() => {
    const count = adult + child;
    const prev = formsRef.current;
    if (prev.length > count) {
      for (const form of prev.slice(count)) {
        if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
      }
    }
    setTravelerForms((forms) => {
      if (forms.length === count) return forms;
      if (forms.length > count) return forms.slice(0, count);
      return [
        ...forms,
        ...Array.from({ length: count - forms.length }, emptyTraveler),
      ];
    });
  }, [adult, child]);

  // Release every local preview when the wizard unmounts.
  useEffect(() => {
    return () => {
      for (const form of formsRef.current) {
        if (form.previewUrl) URL.revokeObjectURL(form.previewUrl);
      }
    };
  }, []);

  /** Picking another airport invalidates the service and its add-ons. */
  const chooseAirport = (id: string) => {
    setAirportId(id);
    setServiceKey("");
    setAddOnQty({});
  };

  const airport = airports.find((a) => a.id === airportId) ?? null;
  /** The label the place tree submits for an airport ("Ngurah Rai (DPS)"). */
  const airportValue = airport
    ? placeLabel({ kind: "airport", name: airport.name, iataCode: airport.iataCode })
    : "";
  const airline = airlines.find((a) => a.code === airlineCode) ?? null;
  const service =
    services.find((s) => `${s.slug}::${s.packageId}` === serviceKey) ?? null;
  const countryOption = countries.find((c) => c.name === country) ?? null;

  const visibleServices = useMemo(
    () => (airportId ? services.filter((s) => s.airportId === airportId) : []),
    [services, airportId],
  );

  /** The services of this airport, grouped under their service type. */
  const serviceGroups = useMemo(() => {
    const groups = new Map<string, AirportServiceOption[]>();
    for (const option of visibleServices) {
      const bucket = groups.get(option.categoryName);
      if (bucket) bucket.push(option);
      else groups.set(option.categoryName, [option]);
    }
    return [...groups.entries()];
  }, [visibleServices]);

  const selectedAddOns = service
    ? service.addOns.flatMap((a) => {
        const qty = addOnQty[a.slug] ?? 0;
        return qty > 0 ? [{ ...a, qty }] : [];
      })
    : [];

  const addOnsUsdCents = selectedAddOns.reduce(
    (sum, a) => sum + a.unitUsdCents * a.qty,
    0,
  );

  const totalUsdCents = service
    ? service.adultUsdCents * adult + service.childUsdCents * child + addOnsUsdCents
    : 0;

  // The server-computed tax preview — the same computation the booking
  // creation applies, so the summary shows the tax-inclusive total BEFORE
  // the customer submits.
  const [taxPreview, setTaxPreview] = useState<TaxPreview | null>(null);
  useEffect(() => {
    let cancelled = false;
    previewTaxes(totalUsdCents).then((result) => {
      if (!cancelled) setTaxPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [totalUsdCents]);
  const taxUsdCents = taxPreview?.totalUsdCents ?? 0;
  const grandTotalUsdCents = totalUsdCents + taxUsdCents;

  const ruleRows = bookingRuleRows(
    rules,
    service ? { hours: service.leadTimeHours, days: service.leadTimeDays } : undefined,
    lang === "id" ? "id" : "en",
  );

  const serviceSteps = service
    ? resolveServiceSteps(serviceInfo, service.included, airport?.iataCode ?? null)
    : [];

  const airportNote = airport?.iataCode
    ? (serviceInfo[airport.iataCode]?.note ?? serviceInfo.default?.note)
    : serviceInfo.default?.note;

  /** The service datetime — the anchor of the 6-month passport rule. */
  const serviceDate = useMemo(
    () => (date ? new Date(`${date}T${time}:00`) : null),
    [date, time],
  );

  /** The earliest acceptable passport expiry (service date + 6 months). */
  const minExpiry = useMemo(() => {
    if (!serviceDate || !Number.isFinite(serviceDate.getTime())) return null;
    const min = new Date(serviceDate.getTime());
    min.setMonth(min.getMonth() + 6);
    return min;
  }, [serviceDate]);

  /** Inline error when a traveler's passport expires too soon. */
  const expiryErrorFor = (form: TravelerForm): string | null => {
    if (!form.passportExpiry || !minExpiry) return null;
    const expiry = new Date(`${form.passportExpiry}T00:00:00`);
    if (!Number.isFinite(expiry.getTime()) || expiry >= minExpiry) return null;
    return t("airportVip.passenger.expiryError", {
      date: minExpiry.toLocaleDateString(dateLocale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    });
  };

  /** "2 adult(s), 1 child(ren)" in the active language. */
  const paxSummary =
    t("airportVip.pax.adults", { n: adult }) +
    (child > 0 ? `, ${t("airportVip.pax.children", { n: child })}` : "");

  /** The VOA add-on is offered and the traveller's country needs one. */
  const showVoaHint = Boolean(
    countryOption?.voaEligible &&
      service?.addOns.some((a) => a.slug === "voa-handling"),
  );

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  /** Can the customer leave the current step? */
  const canContinue = (): boolean => {
    switch (step) {
      case "country":
        return Boolean(country);
      case "airport":
        return Boolean(airportId);
      case "datetime":
        return Boolean(date && time);
      case "flight":
        return Boolean(airlineCode && flightCode.trim());
      case "service":
        return Boolean(service);
      case "passenger": {
        if (!leadName.trim() || !email.trim() || !phone.trim()) return false;
        const count = adult + child;
        if (travelerForms.length !== count) return false;
        return travelerForms.every(
          (form) => form.fullName.trim() !== "" && !expiryErrorFor(form),
        );
      }
      default:
        return true;
    }
  };

  const goNext = () => {
    if (!canContinue()) return;
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.key);
  };

  const goBack = () => {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev.key);
  };

  const updateTraveler = (index: number, patch: Partial<TravelerForm>) => {
    setTravelerForms((forms) =>
      forms.map((form, i) => (i === index ? { ...form, ...patch } : form)),
    );
  };

  /** Validate, preview and upload one traveler's passport photo. */
  const handlePhoto = async (index: number, file: File | null) => {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      updateTraveler(index, { uploadError: t("airportVip.passenger.badType") });
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      updateTraveler(index, { uploadError: t("airportVip.passenger.fileTooBig") });
      return;
    }

    const previous = formsRef.current[index];
    if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
    const previewUrl = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : null;
    updateTraveler(index, {
      photoName: file.name,
      previewUrl,
      photoKey: "",
      uploading: true,
      uploadError: null,
    });

    const result = await uploadPassportPhoto(file);
    if (result.ok) {
      updateTraveler(index, { photoKey: result.key, uploading: false });
    } else {
      updateTraveler(index, { uploading: false, uploadError: result.error });
    }
  };

  const handleSubmit = async () => {
    if (!service || submitting) return;
    // Re-check the document data even though the passenger step gated it —
    // the confirm step's canContinue() is trivially true.
    if (
      !leadName.trim() ||
      !email.trim() ||
      !phone.trim() ||
      travelerForms.length !== adult + child ||
      travelerForms.some((form) => !form.fullName.trim() || expiryErrorFor(form))
    ) {
      setStep("passenger");
      return;
    }

    setSubmitting(true);
    setError(null);

    const serviceAt = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(serviceAt.getTime())) {
      setError(t("airportVip.invalidDate"));
      setSubmitting(false);
      return;
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    const result = await createBooking({
      productSlug: service.slug,
      packageId: service.packageId,
      serviceAt: serviceAt.toISOString(),
      adult,
      child,
      infant: 0,
      idempotencyKey: idempotencyKeyRef.current,
      addOns: selectedAddOns.map((a) => ({ slug: a.slug, qty: a.qty })),
      contact: {
        firstName: leadName.trim(),
        lastName: "",
        email: email.trim(),
        phoneCountryCode: "ID",
        phone: phone.trim(),
        isGuestSelf: false,
        nationality: country || undefined,
        notes: notes.trim() || undefined,
      },
      flight: {
        airportName: airport
          ? `${airport.name}${airport.iataCode ? ` (${airport.iataCode})` : ""}`
          : undefined,
        location: airport?.city,
        airline: airline ? `${airline.name} (${airline.code})` : undefined,
        flightCode: flightCode.trim().toUpperCase(),
        direction,
      },
      travelers: travelerForms.map((form, i) => ({
        fullName: form.fullName.trim(),
        kind: i < adult ? "adult" : "child",
        passportNumber: form.passportNumber.trim() || undefined,
        nationality: form.nationality || country || undefined,
        dateOfBirth: form.dateOfBirth
          ? new Date(`${form.dateOfBirth}T00:00:00`).toISOString()
          : undefined,
        passportExpiry: form.passportExpiry
          ? new Date(`${form.passportExpiry}T00:00:00`).toISOString()
          : undefined,
        passportPhotoKey: form.photoKey || undefined,
      })),
    });

    setSubmitting(false);

    if (result.ok) {
      setCode(result.code);
    } else {
      setError(result.error);
    }
  };

  /* ----------------------------------------------------------------- */
  /* Success                                                           */
  /* ----------------------------------------------------------------- */
  if (code) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-dark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m5 13 4 4L19 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <h1 className="mt-4 text-[20px] font-bold tracking-[-0.01em] text-ink">
          {t("airportVip.success.title")}
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          {t("airportVip.success.subtitle")}
        </p>

        <p className="mt-5 rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-[16px] font-bold tracking-[0.06em] text-ink">
          {code}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/account/orders"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
          >
            {t("airportVip.success.viewOrders")}
          </Link>
          <Link
            href="/airport-vip"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
          >
            {t("airportVip.success.bookAgain")}
          </Link>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- */
  /* Wizard                                                            */
  /* ----------------------------------------------------------------- */
  return (
    <div>
      {/* Stepper */}
      <ol className="mb-7 flex flex-wrap gap-2">
        {STEPS.map((s, index) => {
          const active = s.key === step;
          const done = index < stepIndex;

          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={index > stepIndex}
                onClick={() => index <= stepIndex && setStep(s.key)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active
                    ? "border-brand bg-brand text-white"
                    : done
                      ? "border-brand/30 bg-brand-soft text-brand-dark"
                      : "border-line bg-white text-muted"
                }`}
              >
                <span className="font-semibold">{index + 1}</span>
                {t(s.labelKey)}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-line bg-white p-6">
          {/* Step 1 — Country */}
          {step === "country" ? (
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
                {t("airportVip.country.title")}
              </h2>
              <p className="mt-1.5 text-[13px] text-muted">
                {t("airportVip.country.subtitle")}
              </p>

              {countries.length === 0 ? (
                <p className="mt-5 rounded-xl border border-line bg-canvas px-4 py-3 text-[13px] text-muted">
                  {t("airportVip.country.empty")}
                </p>
              ) : (
                <div className="mt-5 max-w-sm">
                  <SearchableSelect
                    ariaLabel={t("airportVip.country.title")}
                    options={countries.map((c) => ({
                      value: c.name,
                      label: c.name,
                      hint: c.code,
                    }))}
                    value={country}
                    onChange={setCountry}
                    placeholder={t("airportVip.country.placeholder")}
                    searchPlaceholder={t("airportVip.country.searchPlaceholder")}
                    emptyText={t("airportVip.country.noMatch")}
                  />
                </div>
              )}

              {/* Document awareness — VOA eligible or not. */}
              {countryOption ? (
                <p className="mt-4 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-[13px] leading-relaxed text-brand-dark">
                  {countryOption.voaEligible
                    ? t("airportVip.country.voaNote", { country: countryOption.name })
                    : t("airportVip.country.visaNote", { country: countryOption.name })}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Step 2 — Airport */}
          {step === "airport" ? (
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
                {t("airportVip.airport.title")}
              </h2>
              <p className="mt-1.5 text-[13px] text-muted">
                {t("airportVip.airport.subtitle")}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {(["arrival", "departure"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={`rounded-xl border px-4 py-3 text-left text-[13px] font-semibold transition-colors ${
                      direction === d
                        ? "border-brand bg-brand-soft text-brand-dark"
                        : "border-line bg-white text-ink hover:bg-canvas"
                    }`}
                  >
                    {d === "arrival"
                      ? t("airportVip.airport.arrival")
                      : t("airportVip.airport.departure")}
                  </button>
                ))}
              </div>

              {placeTree.length > 0 ? (
                /* Grouped / cascading picker — drill region → country →
                   province → city down to the airport, or search across the
                   whole tree. The submitted value stays the airport label;
                   the wizard keeps working with the airport id. */
                /* Bounded flex column — PlaceOptionList's list stretches
                   into the leftover height and scrolls there. */
                <div className="mt-5 flex h-80 flex-col rounded-xl border border-line bg-white p-3">
                  <div className="relative mb-2 shrink-0">
                    <SearchIcon
                      width={16}
                      height={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      value={airportQuery}
                      onChange={(e) => setAirportQuery(e.target.value)}
                      placeholder={t("airportVip.airport.searchPlaceholder")}
                      className="w-full rounded-xl border border-line bg-canvas py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-brand"
                    />
                  </div>
                  <PlaceOptionList
                    nodes={placeTree}
                    query={airportQuery}
                    selected={airportValue}
                    selectableKinds={["airport"]}
                    onSelect={(label) => {
                      const match = airports.find(
                        (a) =>
                          placeLabel({ kind: "airport", name: a.name, iataCode: a.iataCode }) === label,
                      );
                      if (match) chooseAirport(match.id);
                    }}
                  />
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  {airports.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => chooseAirport(a.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                        airportId === a.id
                          ? "border-brand bg-brand-soft"
                          : "border-line bg-white hover:bg-canvas"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold text-ink">
                          {a.name}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-muted">{a.city}</span>
                      </span>
                      {a.iataCode ? (
                        <span className="shrink-0 rounded-lg bg-canvas px-2 py-1 font-mono text-[11px] font-semibold text-ink">
                          {a.iataCode}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Step 3 — Date & time */}
          {step === "datetime" ? (
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
                {t("airportVip.datetime.title")}
              </h2>
              <p className="mt-1.5 text-[13px] text-muted">
                {t("airportVip.datetime.subtitle")}
              </p>

              <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
                <label className="block">
                  <span className={FIELD_LABEL}>{t("airportVip.datetime.date")}</span>
                  <select
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={FIELD_INPUT}
                  >
                    {dates.map((d) => (
                      <option key={d} value={d}>
                        {new Date(`${d}T00:00:00`).toLocaleDateString(dateLocale, {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className={FIELD_LABEL}>{t("airportVip.datetime.time")}</span>
                  <select
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className={FIELD_INPUT}
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          {/* Step 4 — Flight */}
          {step === "flight" ? (
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
                {t("airportVip.flight.title")}
              </h2>
              <p className="mt-1.5 text-[13px] text-muted">
                {t("airportVip.flight.subtitle")}
              </p>

              <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
                <label className="block">
                  <span className={FIELD_LABEL}>{t("airportVip.flight.airline")}</span>
                  <select
                    value={airlineCode}
                    onChange={(e) => setAirlineCode(e.target.value)}
                    className={FIELD_INPUT}
                  >
                    <option value="">{t("airportVip.flight.selectAirline")}</option>
                    {airlines.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.name} ({a.code})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className={FIELD_LABEL}>{t("airportVip.flight.flightNumber")}</span>
                  <input
                    type="text"
                    value={flightCode}
                    onChange={(e) => setFlightCode(e.target.value.toUpperCase())}
                    placeholder="GA 012"
                    className="h-11 w-full rounded-xl border border-line bg-white px-3 font-mono text-[13px] tracking-[0.04em] text-ink outline-none transition-colors focus:border-brand"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {/* Step 5 — Service */}
          {step === "service" ? (
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
                {t("airportVip.service.title")}
              </h2>
              <p className="mt-1.5 text-[13px] text-muted">
                {t("airportVip.service.subtitle")}
              </p>

              {serviceGroups.length === 0 ? (
                <p className="mt-5 rounded-xl border border-line bg-canvas px-4 py-3 text-[13px] text-muted">
                  {t("airportVip.service.empty")}
                </p>
              ) : null}

              <div className="mt-5 space-y-5">
                {serviceGroups.map(([category, options]) => (
                  <div key={category}>
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
                      {category}
                    </h3>

                    <div className="mt-2 space-y-2.5">
                      {options.map((s) => {
                        const value = `${s.slug}::${s.packageId}`;
                        const active = value === serviceKey;

                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setServiceKey(value)}
                            className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition-colors ${
                              active
                                ? "border-brand bg-brand-soft"
                                : "border-line bg-white hover:bg-canvas"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block text-[14px] font-semibold text-ink">
                                {s.title}
                              </span>
                              <span className="mt-0.5 block text-[12px] text-muted">
                                {s.packageLabel}
                                {s.direction ? ` · ${s.direction}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-[14px] font-bold text-ink">
                              {formatMoney((s.adultUsdCents || s.childUsdCents) / 100)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {service ? (
                <>
                  {/* Service description */}
                  <section className="mt-6 rounded-xl border border-line bg-canvas p-5">
                    <h3 className="text-[14px] font-bold tracking-[-0.01em] text-ink">
                      {t("airportVip.service.details")}
                    </h3>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {airport
                        ? `${airport.name}${airport.iataCode ? ` (${airport.iataCode})` : ""}`
                        : service.title}
                    </p>

                    {service.description ? (
                      <p className="mt-3 text-[13px] leading-relaxed text-ink">
                        {service.description}
                      </p>
                    ) : null}

                    {serviceSteps.length > 0 ? (
                      <ol className="mt-3 space-y-1.5">
                        {serviceSteps.map((item, index) => (
                          <li key={item} className="flex gap-2.5 text-[13px] text-ink">
                            <span className="shrink-0 font-semibold text-brand">
                              {index + 1}.
                            </span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {service.requirements.length > 0 ? (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="text-[12px] font-semibold text-ink">
                          {t("airportVip.service.requirements")}
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {service.requirements.map((item) => (
                            <li key={item} className="text-[12px] text-muted">
                              · {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {airportNote ? (
                      <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
                        <span className="font-semibold text-ink">
                          {t("airportVip.service.airportNote", {
                            airport: airport?.iataCode ?? airport?.name ?? "",
                          })}
                        </span>{" "}
                        {airportNote}
                      </p>
                    ) : null}
                  </section>

                  {/* Optional add-ons */}
                  {service.addOns.length > 0 ? (
                    <section className="mt-4">
                      <h3 className="text-[14px] font-bold tracking-[-0.01em] text-ink">
                        {t("airportVip.service.addOns")}
                      </h3>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {t("airportVip.service.addOnsSubtitle")}
                      </p>

                      {showVoaHint ? (
                        <p className="mt-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-[12px] leading-relaxed text-brand-dark">
                          {t("airportVip.service.voaHint", { country })}
                        </p>
                      ) : null}

                      <div className="mt-3 space-y-2">
                        {service.addOns.map((a) => (
                          <PaxStepper
                            key={a.slug}
                            label={a.title}
                            price={`${formatMoney(a.unitUsdCents / 100)} ${t("airportVip.service.perUnit")}`}
                            value={addOnQty[a.slug] ?? 0}
                            max={10}
                            onChange={(next) =>
                              setAddOnQty((prev) => ({ ...prev, [a.slug]: next }))
                            }
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {/* Step 6 — Travelers & documents */}
          {step === "passenger" ? (
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
                {t("airportVip.passenger.title")}
              </h2>
              <p className="mt-1.5 text-[13px] text-muted">
                {t("airportVip.passenger.subtitle")}
              </p>

              <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
                <label className="block">
                  <span className={FIELD_LABEL}>{t("airportVip.passenger.adults")}</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={adult}
                    onChange={(e) => setAdult(Math.max(1, Number(e.target.value) || 1))}
                    className={FIELD_INPUT}
                  />
                </label>

                <label className="block">
                  <span className={FIELD_LABEL}>{t("airportVip.passenger.children")}</span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={child}
                    onChange={(e) => setChild(Math.max(0, Number(e.target.value) || 0))}
                    className={FIELD_INPUT}
                  />
                </label>
              </div>

              {/* One document card per traveler. */}
              <div className="mt-5 space-y-4">
                {travelerForms.map((form, index) => {
                  const expiryError = expiryErrorFor(form);
                  const kindLabel =
                    index < adult
                      ? t("airportVip.passenger.adult")
                      : t("airportVip.passenger.child");

                  return (
                    <section
                      key={index}
                      className="rounded-xl border border-line bg-canvas p-4"
                    >
                      <h3 className="text-[13px] font-bold text-ink">
                        {t("airportVip.passenger.travelerN", {
                          n: index + 1,
                          kind: kindLabel,
                        })}
                      </h3>

                      <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
                        <label className="block sm:col-span-2">
                          <span className={FIELD_LABEL}>
                            {t("airportVip.passenger.fullName")}
                          </span>
                          <input
                            type="text"
                            value={form.fullName}
                            onChange={(e) =>
                              updateTraveler(index, { fullName: e.target.value })
                            }
                            className={FIELD_INPUT}
                          />
                        </label>

                        <label className="block">
                          <span className={FIELD_LABEL}>
                            {t("airportVip.passenger.passportNumber")}
                          </span>
                          <input
                            type="text"
                            value={form.passportNumber}
                            onChange={(e) =>
                              updateTraveler(index, {
                                passportNumber: e.target.value.toUpperCase(),
                              })
                            }
                            className="h-11 w-full rounded-xl border border-line bg-white px-3 font-mono text-[13px] tracking-[0.04em] text-ink outline-none transition-colors focus:border-brand"
                          />
                        </label>

                        <label className="block">
                          <span className={FIELD_LABEL}>
                            {t("airportVip.passenger.nationality")}
                          </span>
                          <select
                            value={form.nationality || country}
                            onChange={(e) =>
                              updateTraveler(index, { nationality: e.target.value })
                            }
                            className={FIELD_INPUT}
                          >
                            {countries.map((c) => (
                              <option key={c.code} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className={FIELD_LABEL}>
                            {t("airportVip.passenger.dateOfBirth")}
                          </span>
                          <input
                            type="date"
                            value={form.dateOfBirth}
                            onChange={(e) =>
                              updateTraveler(index, { dateOfBirth: e.target.value })
                            }
                            className={FIELD_INPUT}
                          />
                        </label>

                        <label className="block">
                          <span className={FIELD_LABEL}>
                            {t("airportVip.passenger.passportExpiry")}
                          </span>
                          <input
                            type="date"
                            value={form.passportExpiry}
                            onChange={(e) =>
                              updateTraveler(index, { passportExpiry: e.target.value })
                            }
                            className={`${FIELD_INPUT} ${
                              expiryError ? "border-danger focus:border-danger" : ""
                            }`}
                          />
                          {expiryError ? (
                            <span className="mt-1 block text-[12px] text-danger">
                              {expiryError}
                            </span>
                          ) : null}
                        </label>

                        {/* Passport photo — private upload with local preview. */}
                        <div className="block sm:col-span-2">
                          <span className={FIELD_LABEL}>
                            {t("airportVip.passenger.photo")}
                          </span>
                          <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
                            {form.previewUrl ? (
                              // Local object-URL preview — never a stored URL.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={form.previewUrl}
                                alt={form.photoName}
                                className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover"
                              />
                            ) : form.photoName ? (
                              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas font-mono text-[10px] font-bold uppercase text-muted">
                                PDF
                              </span>
                            ) : null}

                            <div className="min-w-0 flex-1">
                              {form.photoName ? (
                                <p className="truncate text-[12px] font-medium text-ink">
                                  {form.photoName}
                                </p>
                              ) : null}
                              <p className="mt-0.5 text-[11px] text-muted">
                                {form.uploading
                                  ? t("airportVip.passenger.uploading")
                                  : form.photoKey
                                    ? `${t("airportVip.passenger.uploaded")} ✓`
                                    : t("airportVip.passenger.photoHint")}
                              </p>
                              {form.uploadError ? (
                                <p className="mt-0.5 text-[11px] text-danger">
                                  {form.uploadError}
                                </p>
                              ) : null}
                            </div>

                            <label
                              className={`inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink transition-colors hover:bg-canvas ${
                                form.uploading ? "pointer-events-none opacity-50" : ""
                              }`}
                            >
                              {form.photoName
                                ? t("airportVip.passenger.replace")
                                : t("airportVip.passenger.chooseFile")}
                              <input
                                type="file"
                                accept={PHOTO_TYPES.join(",")}
                                className="hidden"
                                disabled={form.uploading}
                                onChange={(e) => {
                                  const file = e.target.files?.[0] ?? null;
                                  e.target.value = "";
                                  void handlePhoto(index, file);
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>

              <p className="mt-3 text-[12px] text-muted">
                {t("airportVip.passenger.docsLater")}
              </p>

              {/* Lead contact */}
              <div className="mt-5 grid gap-3.5 border-t border-line pt-5 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className={FIELD_LABEL}>{t("airportVip.passenger.leadName")}</span>
                  <input
                    type="text"
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    className={FIELD_INPUT}
                  />
                </label>

                <label className="block">
                  <span className={FIELD_LABEL}>{t("airportVip.passenger.email")}</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={FIELD_INPUT}
                  />
                </label>

                <label className="block">
                  <span className={FIELD_LABEL}>{t("airportVip.passenger.phone")}</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t("airportVip.passenger.phonePlaceholder")}
                    className={FIELD_INPUT}
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className={FIELD_LABEL}>{t("airportVip.passenger.notes")}</span>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-ink outline-none transition-colors focus:border-brand"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {/* Step 7 — Confirm */}
          {step === "confirm" ? (
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
                {t("airportVip.confirm.title")}
              </h2>
              <p className="mt-1.5 text-[13px] text-muted">
                {t("airportVip.confirm.subtitle")}
              </p>

              <dl className="mt-5 divide-y divide-line border-y border-line">
                <Row label={t("airportVip.confirm.country")} value={country || "—"} />
                <Row
                  label={t("airportVip.confirm.airport")}
                  value={airport ? `${airport.name} (${airport.city})` : "—"}
                />
                <Row
                  label={t("airportVip.confirm.direction")}
                  value={
                    direction === "arrival"
                      ? t("airportVip.confirm.arrival")
                      : t("airportVip.confirm.departure")
                  }
                />
                <Row
                  label={t("airportVip.confirm.schedule")}
                  value={`${
                    date
                      ? new Date(`${date}T00:00:00`).toLocaleDateString(dateLocale, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"
                  } · ${time}`}
                />
                <Row
                  label={t("airportVip.confirm.flight")}
                  value={
                    airline
                      ? `${airline.name} (${airline.code})${
                          flightCode ? ` · ${flightCode.toUpperCase()}` : ""
                        }`
                      : "—"
                  }
                />
                <Row
                  label={t("airportVip.confirm.service")}
                  value={service ? `${service.title} · ${service.packageLabel}` : "—"}
                />
                <Row label={t("airportVip.confirm.passengers")} value={paxSummary} />
                {selectedAddOns.map((a) => (
                  <Row
                    key={a.slug}
                    label={t("airportVip.confirm.addOn")}
                    value={`${a.title} ×${a.qty}`}
                  />
                ))}
                <Row label={t("airportVip.confirm.name")} value={leadName || "—"} />
                <Row label={t("airportVip.confirm.email")} value={email || "—"} />
                <Row label={t("airportVip.confirm.phone")} value={phone || "—"} />
              </dl>

              {/* Per-traveler document summary */}
              <h3 className="mt-6 text-[13px] font-bold text-ink">
                {t("airportVip.confirm.travelers")}
              </h3>
              <div className="mt-2 space-y-3">
                {travelerForms.map((form, index) => (
                  <dl
                    key={index}
                    className="divide-y divide-line rounded-xl border border-line px-4"
                  >
                    <Row
                      label={t("airportVip.passenger.travelerN", {
                        n: index + 1,
                        kind:
                          index < adult
                            ? t("airportVip.passenger.adult")
                            : t("airportVip.passenger.child"),
                      })}
                      value={form.fullName || "—"}
                    />
                    <Row
                      label={t("airportVip.confirm.passportNo")}
                      value={form.passportNumber || "—"}
                    />
                    <Row
                      label={t("airportVip.confirm.nationality")}
                      value={form.nationality || country || "—"}
                    />
                    <Row
                      label={t("airportVip.confirm.expiry")}
                      value={
                        form.passportExpiry
                          ? new Date(`${form.passportExpiry}T00:00:00`).toLocaleDateString(
                              dateLocale,
                              { day: "2-digit", month: "short", year: "numeric" },
                            )
                          : "—"
                      }
                    />
                    <Row
                      label={t("airportVip.confirm.photo")}
                      value={
                        form.photoKey
                          ? t("airportVip.confirm.uploaded")
                          : t("airportVip.confirm.missing")
                      }
                    />
                  </dl>
                ))}
              </div>

              {error ? (
                <p className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Navigation */}
          <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
            <button
              type="button"
              onClick={goBack}
              disabled={stepIndex === 0}
              className="h-11 rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("airportVip.back")}
            </button>

            {step === "confirm" ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="h-11 rounded-xl bg-brand px-6 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t("airportVip.submitting") : t("airportVip.submit")}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                disabled={!canContinue()}
                className="h-11 rounded-xl bg-brand px-6 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("airportVip.continue")}
              </button>
            )}
          </div>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
              {t("airportVip.summary.title")}
            </h2>

            <dl className="mt-4 space-y-2.5 text-[13px]">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">{t("airportVip.summary.country")}</dt>
                <dd className="text-right font-medium text-ink">
                  {country || "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">{t("airportVip.summary.airport")}</dt>
                <dd className="text-right font-medium text-ink">
                  {airport?.city ?? "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">{t("airportVip.summary.schedule")}</dt>
                <dd className="text-right font-medium text-ink">
                  {date ? `${date} · ${time}` : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">{t("airportVip.summary.service")}</dt>
                <dd className="text-right font-medium text-ink">
                  {service?.title ?? "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">{t("airportVip.summary.passengers")}</dt>
                <dd className="text-right font-medium text-ink">{paxSummary}</dd>
              </div>
            </dl>

            {selectedAddOns.length > 0 ? (
              <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[12px]">
                {selectedAddOns.map((a) => (
                  <div key={a.slug} className="flex items-center justify-between gap-4">
                    <dt className="text-muted">
                      {a.title} ×{a.qty}
                    </dt>
                    <dd className="text-right text-ink">
                      {formatMoney((a.unitUsdCents * a.qty) / 100)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {/* Base price + taxes = the tax-inclusive total. */}
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[12px] text-muted">
                  {t("airportVip.summary.basePrice")}
                </span>
                <span className="text-[13px] font-medium text-ink">
                  {formatMoney(totalUsdCents / 100)}
                </span>
              </div>

              {taxPreview?.lines.map((line) => (
                <div
                  key={line.key}
                  className="mt-1.5 flex items-center justify-between gap-4"
                >
                  <span className="text-[12px] text-muted">
                    {t("airportVip.summary.tax")} · {line.label} ({line.value})
                  </span>
                  <span className="text-[13px] font-medium text-ink">
                    {formatMoney(line.amountUsdCents / 100)}
                  </span>
                </div>
              ))}

              <p className="mt-3 text-[12px] font-semibold text-ink">
                {t("airportVip.summary.total")}
              </p>
              <p className="mt-0.5 text-[24px] font-bold tracking-[-0.02em] text-ink">
                {formatMoney(grandTotalUsdCents / 100)}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {service
                  ? `${service.title} · ${t("airportVip.summary.paxCount", { n: adult + child })}`
                  : t("airportVip.summary.pickService")}
              </p>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              {t("airportVip.summary.surchargeNote")}
            </p>
          </div>

          {/* Booking rules */}
          <div className="mt-4 rounded-2xl border border-line bg-white p-5">
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
              {t("airportVip.rules.title")}
            </h2>

            <dl className="mt-3 divide-y divide-line text-[12px]">
              {ruleRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-start justify-between gap-4 py-2"
                >
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="shrink-0 text-right font-medium text-ink">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
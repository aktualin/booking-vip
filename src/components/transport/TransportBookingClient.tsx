"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createBooking } from "@/app/actions/booking";
import PaymentStep from "@/components/payment/PaymentStep";
import { useLocale } from "@/components/providers/LocaleProvider";
import type { TransportVehicleDTO } from "@/app/actions/catalog";

type Props = {
  vehicles: TransportVehicleDTO[];
  /** The values that came from the search (the entry page). */
  initial?: {
    /** The vehicle that was picked on the fleet list ("slug::packageId"). */
    vehicle?: string;
    date?: string;
    time?: string;
    /** The number of rental days. */
    days?: number;
    driverOption?: string;
  };
};

/** One line of the cart — one car, one package, days × units. */
type CartLine = {
  id: string;
  productSlug: string;
  packageId: string;
  title: string;
  packageLabel: string;
  unitUsdCents: number;
  days: number;
  vehicleCount: number;
};

/** One car of the picker — the per_day packages of one product. */
type CarOption = {
  productSlug: string;
  title: string;
  parentSlug: string | null;
  parentName: string | null;
  availableStock: number;
  packages: { packageId: string; packageLabel: string; unitUsdCents: number }[];
};

/** The per-car inputs of the cart builder. */
type BuilderState = { packageId: string; days: number; qty: number };

/** The next 30 days as `YYYY-MM-DD`. */
function upcomingDates(): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 1; i <= 30; i++) {
    const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

const TIME_SLOTS = [
  "06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

const inputClass =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

/**
 * The booking form of the transport flow — a multi-car cart.
 *
 * The customer builds a cart of daily rentals (each line: a car, its rental
 * package, the days and the number of units), then checks out ONCE: one
 * booking, one invoice, one payment. The quantity of every car is capped by
 * its available stock minus what the cart already holds.
 */
export default function TransportBookingClient({ vehicles, initial }: Props) {
  const { formatMoney, lang, t } = useLocale();
  const dates = useMemo(() => upcomingDates(), []);
  const dateLocale = lang === "id" ? "id-ID" : "en-US";

  const [date, setDate] = useState(initial?.date ?? dates[0] ?? "");
  const [time, setTime] = useState(initial?.time ?? "09:00");
  const [days, setDays] = useState(Math.min(365, Math.max(1, initial?.days ?? 1)));
  const [driverOption, setDriverOption] = useState(
    initial?.driverOption ?? "with_driver",
  );
  const [pickupPolicy, setPickupPolicy] = useState("vendor_pickup");
  const [adult, setAdult] = useState(1);
  const [child, setChild] = useState(0);
  const [title, setTitle] = useState("mr");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  // The server computes the final total (incl. tax) and the invoice number —
  // the payment step must show exactly what Xendit will charge.
  const [serverTotalUsdCents, setServerTotalUsdCents] = useState<number | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);

  // One idempotency key per checkout attempt — generated once, reused across
  // retries of the same attempt, and only replaced when the customer starts
  // a genuinely new order after a success.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // The cart. The vehicle picked on the fleet list starts in it (one unit,
  // the searched number of days) — the old flow booked that car directly.
  const [cart, setCart] = useState<CartLine[]>(() => {
    const pick = initial?.vehicle;
    if (!pick) return [];
    const v = vehicles.find((x) => `${x.productSlug}::${x.packageId}` === pick);
    if (!v || v.unitKind !== "per_day") return [];
    return [
      {
        id: crypto.randomUUID(),
        productSlug: v.productSlug,
        packageId: v.packageId,
        title: v.title,
        packageLabel: v.packageLabel,
        unitUsdCents: v.unitUsdCents,
        days: Math.min(365, Math.max(1, initial?.days ?? 1)),
        vehicleCount: 1,
      },
    ];
  });

  // The cars of the picker — one entry per product, daily-rental packages
  // only (the cart books per_day lines; the server refuses anything else).
  const cars = useMemo(() => {
    const bySlug = new Map<string, CarOption>();
    for (const v of vehicles) {
      if (v.unitKind !== "per_day") continue;
      let car = bySlug.get(v.productSlug);
      if (!car) {
        car = {
          productSlug: v.productSlug,
          title: v.title,
          parentSlug: v.parentSlug,
          parentName: v.parentName,
          availableStock: v.availableStock,
          packages: [],
        };
        bySlug.set(v.productSlug, car);
      }
      car.packages.push({
        packageId: v.packageId,
        packageLabel: v.packageLabel,
        unitUsdCents: v.unitUsdCents,
      });
    }
    return [...bySlug.values()];
  }, [vehicles]);

  // The per-car builder inputs — the package defaults to the picked vehicle
  // (or the car's first package), the days to the global rental days.
  const [builder, setBuilder] = useState<Record<string, BuilderState>>(() => {
    const init: Record<string, BuilderState> = {};
    for (const car of cars) {
      const picked =
        initial?.vehicle && initial.vehicle.startsWith(`${car.productSlug}::`)
          ? initial.vehicle.split("::")[1]
          : undefined;
      const pkg =
        car.packages.find((p) => p.packageId === picked) ?? car.packages[0];
      init[car.productSlug] = {
        packageId: pkg?.packageId ?? "",
        days: Math.min(365, Math.max(1, initial?.days ?? 1)),
        qty: 1,
      };
    }
    return init;
  });

  // The cars are grouped by their parent type (the vehicle class), the
  // same parent → child shape the airport line uses.
  const carGroups = useMemo(() => {
    const groups: { name: string; items: CarOption[] }[] = [];
    const bySlug = new Map<string, (typeof groups)[number]>();
    for (const car of cars) {
      const slug = car.parentSlug ?? "other";
      const name = car.parentName ?? t("transport.booking.otherGroup");
      let group = bySlug.get(slug);
      if (!group) {
        group = { name, items: [] };
        bySlug.set(slug, group);
        groups.push(group);
      }
      group.items.push(car);
    }
    return groups;
  }, [cars, t]);

  /** The units of one product the cart already holds. */
  const cartQtyFor = (productSlug: string) =>
    cart
      .filter((l) => l.productSlug === productSlug)
      .reduce((sum, l) => sum + l.vehicleCount, 0);

  /** The units of one car still addable (stock minus the cart's hold). */
  const remainingFor = (car: CarOption) =>
    Math.max(0, car.availableStock - cartQtyFor(car.productSlug));

  const totalUsdCents = cart.reduce(
    (sum, l) => sum + l.unitUsdCents * l.days * l.vehicleCount,
    0,
  );

  /** The global days input is the default of every per-car days input. */
  const changeGlobalDays = (value: number) => {
    const next = Math.min(365, Math.max(1, value));
    setDays(next);
    setBuilder((b) => {
      const updated: Record<string, BuilderState> = {};
      for (const [slug, state] of Object.entries(b)) {
        updated[slug] = { ...state, days: next };
      }
      return updated;
    });
  };

  const addToCart = (car: CarOption) => {
    const b = builder[car.productSlug];
    if (!b) return;
    const pkg = car.packages.find((p) => p.packageId === b.packageId);
    if (!pkg) return;
    const qty = Math.min(Math.max(1, b.qty), remainingFor(car));
    if (qty < 1) return;
    const lineDays = Math.min(365, Math.max(1, b.days));
    setCart((c) => [
      ...c,
      {
        id: crypto.randomUUID(),
        productSlug: car.productSlug,
        packageId: pkg.packageId,
        title: car.title,
        packageLabel: pkg.packageLabel,
        unitUsdCents: pkg.unitUsdCents,
        days: lineDays,
        vehicleCount: qty,
      },
    ]);
    setBuilder((s) => ({
      ...s,
      [car.productSlug]: { ...s[car.productSlug]!, qty: 1 },
    }));
  };

  const updateLine = (
    id: string,
    patch: Partial<Pick<CartLine, "days" | "vehicleCount">>,
  ) => {
    setCart((c) => c.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLine = (id: string) => {
    setCart((c) => c.filter((l) => l.id !== id));
  };

  /** Start a genuinely new order after a success — fresh cart, fresh key. */
  const bookAnother = () => {
    setCart([]);
    setCode(null);
    setServerTotalUsdCents(null);
    setInvoiceNumber(null);
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    if (cart.length === 0) {
      setError(t("transport.booking.emptyCartError"));
      return;
    }

    setSubmitting(true);
    setError(null);

    const serviceAt = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(serviceAt.getTime())) {
      setError(t("transport.booking.invalidDate"));
      setSubmitting(false);
      return;
    }

    const result = await createBooking({
      // The legacy single-product fields are required by the input type but
      // ignored by the cart path — the lines below carry the order.
      productSlug: cart[0]!.productSlug,
      items: cart.map((l) => ({
        productSlug: l.productSlug,
        packageId: l.packageId,
        days: l.days,
        vehicleCount: l.vehicleCount,
      })),
      idempotencyKey,
      serviceAt: serviceAt.toISOString(),
      adult,
      child,
      infant: 0,
      pickupPolicy,
      driverOption,
      notes: notes || undefined,
      addOns: [],
      contact: {
        title,
        firstName,
        lastName,
        email,
        phoneCountryCode: "ID",
        phone,
        isGuestSelf: false,
        notes: notes || undefined,
      },
      flight: {},
      travelers: [],
    });

    setSubmitting(false);

    if (result.ok) {
      setCode(result.code);
      setServerTotalUsdCents(result.totalUsdCents);
      setInvoiceNumber(result.invoiceNumber);
    } else {
      setError(result.error);
    }
  };

  /* ----------------------------------------------------------------- */
  /* Success                                                           */
  /* ----------------------------------------------------------------- */
  if (code) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div className="rounded-2xl border border-line bg-white p-8 text-center">
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
            {t("transport.booking.successTitle")}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted">
            {t("transport.booking.successDesc")}
          </p>

          <p className="mt-5 rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-[16px] font-bold tracking-[0.06em] text-ink">
            {code}
          </p>
          {invoiceNumber ? (
            <p className="mt-2 font-mono text-[12px] text-muted">
              {t("transport.booking.invoiceNo")}: {invoiceNumber}
            </p>
          ) : null}

          {/* Fulfillment copy — how the car(s) reach the customer. */}
          <div className="mt-5 rounded-xl border border-line bg-canvas px-4 py-3 text-left">
            <p className="text-[12px] font-semibold text-ink">
              {t("transport.booking.fulfillmentHeading")}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              {driverOption === "without_driver"
                ? t("transport.booking.fulfillmentWithoutDriver")
                : t("transport.booking.fulfillmentWithDriver")}
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              href="/account/orders"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-opacity hover:bg-brand-dark"
            >
              {t("transport.booking.viewOrders")}
            </Link>
            <Link
              href={`/invoice/${code}`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
            >
              {t("transport.booking.viewInvoice")}
            </Link>
            <Link
              href="/transport"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-5 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
            >
              {t("transport.booking.backToTransport")}
            </Link>
          </div>

          <button
            type="button"
            onClick={bookAnother}
            className="mt-3 text-[12px] font-semibold text-brand hover:underline"
          >
            {t("transport.booking.bookAnother")}
          </button>
        </div>

        {/* The payment step — the gateway invoice is created on the server. */}
        <PaymentStep
          bookingCode={code}
          email={email}
          amountUsdCents={serverTotalUsdCents ?? totalUsdCents}
        />
      </div>
    );
  }

  /* ----------------------------------------------------------------- */
  /* Form                                                              */
  /* ----------------------------------------------------------------- */
  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {/* When */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {t("transport.booking.whenHeading")}
          </h2>

          <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.date")}
              </span>
              <select
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
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
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.time")}
              </span>
              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={inputClass}
              >
                {TIME_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Duration, driver and pickup policy */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {t("transport.booking.durationHeading")}
          </h2>

          <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.days")}
              </span>
              <input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => changeGlobalDays(Number(e.target.value) || 1)}
                className={inputClass}
              />
            </label>

            <div>
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.driverOption")}
              </span>
              <div className="flex gap-2">
                {[
                  { value: "with_driver", label: t("transport.withDriver") },
                  { value: "without_driver", label: t("transport.withoutDriver") },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDriverOption(option.value)}
                    className={`h-11 flex-1 rounded-xl border px-3 text-[13px] font-semibold transition-colors ${
                      driverOption === option.value
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-line bg-white text-muted hover:bg-canvas"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <span className="mb-2 block text-[12px] font-medium text-ink">
              {t("transport.booking.pickupPolicyHeading")}
            </span>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPickupPolicy("vendor_pickup")}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  pickupPolicy === "vendor_pickup"
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-white hover:bg-canvas"
                }`}
              >
                <span className="block text-[13px] font-bold text-ink">
                  {t("transport.booking.vendorPickup")}
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">
                  {t("transport.booking.vendorPickupFree")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPickupPolicy("delivered")}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  pickupPolicy === "delivered"
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-white hover:bg-canvas"
                }`}
              >
                <span className="block text-[13px] font-bold text-ink">
                  {t("transport.booking.delivered")}
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">
                  {t("transport.booking.deliveredFee")}
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* Passengers */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {t("transport.booking.passengersHeading")}
          </h2>

          <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.adults")}
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={adult}
                onChange={(e) => setAdult(Math.max(1, Number(e.target.value) || 1))}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.children")}
              </span>
              <input
                type="number"
                min={0}
                max={10}
                value={child}
                onChange={(e) => setChild(Math.max(0, Number(e.target.value) || 0))}
                className={inputClass}
              />
            </label>
          </div>

          <p className="mt-3 text-[12px] text-muted">
            {t("transport.booking.passengersNote")}
          </p>
        </section>

        {/* Vehicles — the cart builder */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {t("transport.booking.vehiclesHeading")}
          </h2>

          {cars.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">
              {t("transport.booking.noVehicles")}
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              {carGroups.map((group) => (
                <div key={group.name}>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {group.name}
                  </h3>
                  <div className="space-y-2.5">
                    {group.items.map((car) => {
                      const b = builder[car.productSlug];
                      const inCart = cartQtyFor(car.productSlug);
                      const remaining = remainingFor(car);
                      const selectedPkg = car.packages.find(
                        (p) => p.packageId === b?.packageId,
                      );

                      return (
                        <div
                          key={car.productSlug}
                          className="rounded-xl border border-line p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[14px] font-semibold text-ink">
                              {car.title}
                            </span>
                            <span className="text-[12px] font-medium text-muted">
                              {t("transport.stockLeft", { n: car.availableStock })}
                              {inCart > 0
                                ? ` · ${t("transport.booking.stockInCart", { n: inCart })}`
                                : ""}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_88px_88px_auto]">
                            <label className="block">
                              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                                {t("transport.packagesHeading")}
                              </span>
                              <select
                                value={b?.packageId ?? ""}
                                onChange={(e) =>
                                  setBuilder((s) => ({
                                    ...s,
                                    [car.productSlug]: {
                                      ...s[car.productSlug]!,
                                      packageId: e.target.value,
                                    },
                                  }))
                                }
                                className={inputClass}
                              >
                                {car.packages.map((pkg) => (
                                  <option key={pkg.packageId} value={pkg.packageId}>
                                    {pkg.packageLabel} · {formatMoney(pkg.unitUsdCents / 100)}
                                    {t("transport.perDay")}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="block">
                              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                                {t("transport.booking.daysLabel")}
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={365}
                                value={b?.days ?? days}
                                onChange={(e) =>
                                  setBuilder((s) => ({
                                    ...s,
                                    [car.productSlug]: {
                                      ...s[car.productSlug]!,
                                      days: Math.min(365, Math.max(1, Number(e.target.value) || 1)),
                                    },
                                  }))
                                }
                                className={inputClass}
                              />
                            </label>

                            <label className="block">
                              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                                {t("transport.booking.qtyLabel")}
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={Math.max(1, remaining)}
                                value={b?.qty ?? 1}
                                disabled={remaining < 1}
                                onChange={(e) =>
                                  setBuilder((s) => ({
                                    ...s,
                                    [car.productSlug]: {
                                      ...s[car.productSlug]!,
                                      qty: Math.min(
                                        Math.max(1, remaining),
                                        Math.max(1, Number(e.target.value) || 1),
                                      ),
                                    },
                                  }))
                                }
                                className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                              />
                            </label>

                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={() => addToCart(car)}
                                disabled={remaining < 1 || !selectedPkg}
                                className="h-11 rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {t("transport.booking.add")}
                              </button>
                            </div>
                          </div>

                          {remaining < 1 ? (
                            <p className="mt-2 text-[12px] text-muted">
                              {t("transport.booking.stockAllInCart")}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* The cart */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {t("transport.booking.cartHeading")}
          </h2>

          {cart.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">
              {t("transport.booking.cartEmpty")}
            </p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {cart.map((line) => {
                const car = cars.find((c) => c.productSlug === line.productSlug);
                // The line's quantity is capped by the stock minus what the
                // OTHER lines of the same product hold.
                const otherQty = cartQtyFor(line.productSlug) - line.vehicleCount;
                const maxQty = Math.max(
                  1,
                  Math.min(99, (car?.availableStock ?? line.vehicleCount) - otherQty),
                );
                const lineTotal = line.unitUsdCents * line.days * line.vehicleCount;

                return (
                  <div
                    key={line.id}
                    className="rounded-xl border border-line p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-ink">
                          {line.title}
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted">
                          {line.packageLabel} ·{" "}
                          {t("transport.daysSummary", { n: line.days })} ×{" "}
                          {line.vehicleCount}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-[14px] font-bold text-ink">
                          {formatMoney(lineTotal / 100)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          className="text-[12px] font-semibold text-danger hover:underline"
                        >
                          {t("transport.booking.remove")}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink">
                          {t("transport.booking.daysLabel")}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={line.days}
                          onChange={(e) =>
                            updateLine(line.id, {
                              days: Math.min(365, Math.max(1, Number(e.target.value) || 1)),
                            })
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink">
                          {t("transport.booking.qtyLabel")}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={maxQty}
                          value={line.vehicleCount}
                          onChange={(e) =>
                            updateLine(line.id, {
                              vehicleCount: Math.min(
                                maxQty,
                                Math.max(1, Number(e.target.value) || 1),
                              ),
                            })
                          }
                          className={inputClass}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-[13px] font-semibold text-ink">
                  {t("transport.booking.total")}
                </span>
                <span className="text-[16px] font-bold text-ink">
                  {formatMoney(totalUsdCents / 100)}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Contact */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {t("transport.booking.contactHeading")}
          </h2>

          <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.title")}
              </span>
              <select
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
              >
                <option value="mr">{t("transport.booking.titleMr")}</option>
                <option value="mrs">{t("transport.booking.titleMrs")}</option>
                <option value="ms">{t("transport.booking.titleMs")}</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.firstName")}
              </span>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.lastName")}
              </span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.email")}
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.phone")}
              </span>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("transport.booking.phonePlaceholder")}
                className={inputClass}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                {t("transport.booking.notes")}
              </span>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("transport.booking.notesPlaceholder")}
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-ink outline-none transition-colors focus:border-brand"
              />
            </label>
          </div>
        </section>

        {error ? (
          <p className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      {/* Summary */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
            {t("transport.booking.summaryHeading")}
          </h2>

          <dl className="mt-4 space-y-2.5 text-[13px]">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">{t("transport.booking.cartHeading")}</dt>
              <dd className="text-right font-medium text-ink">
                {cart.reduce((sum, l) => sum + l.vehicleCount, 0)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">{t("transport.booking.date")}</dt>
              <dd className="text-right font-medium text-ink">
                {date
                  ? new Date(`${date}T00:00:00`).toLocaleDateString(dateLocale, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">{t("transport.booking.time")}</dt>
              <dd className="text-right font-medium text-ink">{time}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">{t("transport.booking.passengersHeading")}</dt>
              <dd className="text-right font-medium text-ink">
                {t("transport.booking.paxAdults", { n: adult })}
                {child > 0
                  ? `, ${t("transport.booking.paxChildren", { n: child })}`
                  : ""}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <span className="text-[13px] font-semibold text-ink">
              {t("transport.booking.total")}
            </span>
            <span className="text-[18px] font-bold text-ink">
              {formatMoney(totalUsdCents / 100)}
            </span>
          </div>
          <p className="mt-1 text-right text-[11px] text-muted">
            {t("transport.booking.taxNote")}
          </p>

          <button
            type="submit"
            disabled={submitting || cart.length === 0}
            className="mt-5 h-11 w-full rounded-xl bg-brand text-[14px] font-semibold text-white transition-opacity hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? t("transport.booking.submitting")
              : t("transport.booking.submit")}
          </button>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">
            {t("transport.booking.serverTotalNote")}
          </p>
        </div>
      </aside>
    </form>
  );
}

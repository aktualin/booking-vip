"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getProduct, getPlaceOptions } from "@/app/actions/catalog";
import { createBooking } from "@/app/actions/booking";
import { startBookingPayment } from "@/app/actions/payments";
import { parsePickedPoint } from "@/lib/picked-point";
import type { PlaceNode } from "@/lib/places";
import { useLocale } from "@/components/providers/LocaleProvider";
import { useAccountOverview } from "@/components/providers/AccountProvider";
import type { ProductDetailDTO } from "@/types";
import WizardStepper from "./WizardStepper";
import BookingSummary from "./BookingSummary";
import StepAddOns from "./StepAddOns";
import StepDetails from "./StepDetails";
import StepPayment, { type AppliedPromo } from "./StepPayment";
import SignaturePad from "./SignaturePad";
import type { RenterIdentity } from "./RenterIdentityForm";

type Step = "addons" | "details" | "signature" | "payment";

type ContactData = {
  firstName: string;
  lastName: string;
  email: string;
  phoneCountryCode: string;
  phone: string;
  isGuestSelf: boolean;
  notes?: string;
};

type FlightData = {
  airportName: string;
  location: string;
  airline: string;
  flightCode: string;
};

const LAST_BOOKING_KEY = "booking-vip:last-booking";

export default function BookingWizard() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { formatMoney, t } = useLocale();

  const slug = params.slug as string;
  const [product, setProduct] = useState<ProductDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  // The place hierarchy for the location field (city / area / destination,
  // grouped under region → country → province). Empty until loaded — the
  // details step then falls back to the plain text input.
  const [places, setPlaces] = useState<PlaceNode[]>([]);
  useEffect(() => {
    getPlaceOptions(["city", "area", "destination", "district", "village"]).then(setPlaces);
  }, []);

  // Read query params
  const date = searchParams.get("date") ?? "";
  const time = searchParams.get("time") ?? "";
  const adultParam = parseInt(searchParams.get("adult") ?? "1", 10);
  const childParam = parseInt(searchParams.get("child") ?? "0", 10);
  const infantParam = parseInt(searchParams.get("infant") ?? "0", 10);
  const qtyParam = parseInt(searchParams.get("qty") ?? "1", 10);
  const packageId = searchParams.get("pkg") ?? undefined;
  // The transport context — rental days and the picked points travel in the
  // query string from the vehicle detail's sticky bar.
  const daysParam = Math.max(1, parseInt(searchParams.get("days") ?? "1", 10) || 1);
  const pickupPoint = parsePickedPoint(searchParams.get("pickup") ?? undefined);
  const dropoffPoint = parsePickedPoint(searchParams.get("dropoff") ?? undefined);
  const driverOptionParam = searchParams.get("driverOption") ?? undefined;

  const [adults, setAdults] = useState(adultParam);
  const [children, setChildren] = useState(childParam);
  const [infants, setInfants] = useState(infantParam);

  // Wizard state
  const [step, setStep] = useState<Step>("addons");
  const [selectedAddOns, setSelectedAddOns] = useState<
    { slug: string; qty: number }[]
  >([]);

  const [contact, setContact] = useState<ContactData>({
    firstName: "",
    lastName: "",
    email: "",
    phoneCountryCode: "ID",
    phone: "",
    isGuestSelf: true,
    notes: "",
  });

  // Airport name will be derived from product after fetch
  const [flight, setFlight] = useState<FlightData>({
    airportName: "",
    location: "",
    airline: "",
    flightCode: "",
  });

  const [travelers, setTravelers] = useState<
    { fullName: string; kind: string }[]
  >([]);

  // Car rental (transport line) adds renter identity + a signature step.
  const isTransport = product?.lineSlug === "transport";
  const [identity, setIdentity] = useState<RenterIdentity>({
    identityNumber: "",
    idType: "",
    idDocumentUrl: null,
  });
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // One idempotency key per checkout attempt — generated once on mount and
  // reused across retries, so a network hiccup never creates a second
  // booking for the same attempt.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // The booking created by "Bayar Sekarang" — created ONCE; payment retries
  // (a declined card, an expired checkout session) reuse the same booking.
  const [created, setCreated] = useState<{
    code: string;
    totalUsdCents: number;
    invoiceNumber: string;
  } | null>(null);

  // The validated promo/voucher — lifted here so the sticky summary and the
  // result screen show the same discount the server will recompute.
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);

  // Prefill the contact form from the signed-in account (shared provider
  // read, same as StepPayment). Only empty fields are filled, so anything
  // the customer already typed is never overwritten.
  const { overview } = useAccountOverview();
  useEffect(() => {
    if (!overview) return;
    const [firstName = "", ...rest] = (overview.name ?? "")
      .trim()
      .split(/\s+/);
    const lastName = rest.join(" ");
    setContact((c) => ({
      ...c,
      firstName: c.firstName || firstName,
      lastName: c.lastName || lastName,
      email: c.email || overview.email,
      phoneCountryCode: c.phoneCountryCode || "ID",
      phone: c.phone || (overview.phone ?? ""),
    }));
  }, [overview]);

  // Load product
  useEffect(() => {
    setLoading(true);
    getProduct(slug).then((p) => {
      setProduct(p);
      setLoading(false);
      if (p) {
        // Update airport name from product data
        setFlight((f) => ({ ...f, airportName: p.placeLabel ?? "" }));
      }
    });
  }, [slug]);

  const selectedPackage = useMemo(() => {
    if (!product) return null;
    if (packageId) {
      return product.packages.find((p) => p.id === packageId) ?? null;
    }
    return product.packages[0] ?? null;
  }, [product, packageId]);

  // Calculate total for display
  const total = useMemo(() => {
    if (!product || !selectedPackage) return 0;
    const isPerPax = selectedPackage.unitKind === "per_pax";
    let subtotal = 0;
    if (isPerPax) {
      subtotal += (selectedPackage.adultUsd ?? 0) * adults;
      subtotal += (selectedPackage.childUsd ?? 0) * children;
      subtotal += (selectedPackage.infantUsd ?? 0) * infants;
    } else if (selectedPackage.unitKind === "per_day") {
      // per_day: one rental day × the number of days. On the transport line
      // the qty param is the number of vehicles reserved (the server
      // validates it against the available stock).
      const vehicles =
        product.lineSlug === "transport" ? Math.max(1, qtyParam) : 1;
      subtotal += (selectedPackage.unitUsd ?? 0) * daysParam * vehicles;
    } else {
      // per_unit: multiply by quantity
      subtotal += (selectedPackage.unitUsd ?? 0) * qtyParam;
    }
    const addOnsTotal = selectedAddOns.reduce((sum, a) => {
      const addOn = product.addOns.find((o) => o.slug === a.slug);
      return sum + (addOn?.unitUsd ?? 0) * a.qty;
    }, 0);
    return subtotal + addOnsTotal;
  }, [product, selectedPackage, adults, children, infants, selectedAddOns, qtyParam, daysParam]);

  const addOnsWithLabels = useMemo(() => {
    return selectedAddOns.map((a) => {
      const addOn = product?.addOns.find((o) => o.slug === a.slug);
      return {
        slug: a.slug,
        qty: a.qty,
        label: addOn?.label ?? a.slug,
        unitUsd: addOn?.unitUsd ?? 0,
      };
    });
  }, [selectedAddOns, product]);

  /**
   * Pay: create the booking (once) and start the payment for the method the
   * customer picked in the payment step. The browser is redirected to the
   * gateway's hosted checkout (Xendit for card/QRIS/VA, PayPal for PAYPAL);
   * the customer comes back via /payment/return, which polls the status.
   */
  const handlePay = async (methodCode = "CREDIT_CARD") => {
    if (!product || !selectedPackage) return;

    // Guard against missing/invalid date/time BEFORE constructing the ISO
    // string — `new Date(...).toISOString()` throws RangeError on invalid input.
    const serviceAtValue =
      date && time ? new Date(`${date}T${time}:00`) : null;
    if (!date || !time || !serviceAtValue || !Number.isFinite(serviceAtValue.getTime())) {
      setSubmitError(t("wizard.missingDate"));
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    // 1. Create the booking once; retries reuse it so a declined card never
    //    creates a second booking.
    let booking = created;
    if (!booking) {
      const serviceAtISO = serviceAtValue.toISOString();

      // Renter identity + signature ride on the contact payload. For other
      // lines the identity state stays empty, so these fields are undefined.
      const contactPayload = {
        ...contact,
        identityNumber: identity.identityNumber || undefined,
        idType: identity.idType || undefined,
        idDocumentUrl: identity.idDocumentUrl ?? undefined,
        signatureUrl: signatureUrl ?? undefined,
      };

      const result = await createBooking({
        productSlug: slug,
        packageId: selectedPackage.id,
        serviceAt: serviceAtISO,
        adult: adults,
        child: children,
        infant: infants,
        units: selectedPackage.unitKind === "per_unit" ? qtyParam : undefined,
        days: selectedPackage.unitKind === "per_day" ? daysParam : undefined,
        // Transport daily rentals: the qty param reserves that many units.
        // The product DTO carries no stock, so the server validates the
        // count against the available rental stock.
        vehicleCount:
          isTransport && selectedPackage.unitKind === "per_day"
            ? qtyParam
            : undefined,
        idempotencyKey,
        pickup: pickupPoint ?? undefined,
        dropoff: dropoffPoint ?? undefined,
        driverOption: driverOptionParam,
        addOns: selectedAddOns,
        contact: contactPayload,
        // Car rental has no flight info or traveler names — the renter
        // identity replaces them.
        flight: isTransport ? {} : flight,
        travelers: isTransport ? [] : travelers,
        promoCode: appliedPromo?.code,
      });

      if (!result.ok) {
        setSubmitError(result.error);
        setIsSubmitting(false);
        return;
      }

      booking = {
        code: result.code,
        totalUsdCents: result.totalUsdCents,
        invoiceNumber: result.invoiceNumber,
      };
      setCreated(booking);

      // Save to localStorage so the return page can find the email again.
      try {
        localStorage.setItem(
          LAST_BOOKING_KEY,
          JSON.stringify({ code: booking.code, email: contact.email })
        );
      } catch {
        // Storage unavailable
      }
    }

    // 2. Start the payment — the method picked in the payment step (card,
    //    QRIS, Virtual Account via Xendit; PAYPAL via PayPal).
    const result = await startBookingPayment({
      bookingCode: booking.code,
      email: contact.email,
      methodCode,
    });
    if (result.ok) {
      // Off to the gateway's hosted checkout — no result step, the return
      // page takes over after the charge.
      window.location.assign(result.checkoutUrl);
      return;
    }
    setSubmitError(result.error);
    setIsSubmitting(false);
  };

  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted">{t("booking.loadingShort")}</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="py-12 text-center">
        <p className="text-danger">{t("common.productNotFound")}</p>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <WizardStepper currentStep={step} isTransport={isTransport} />

      <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-8">
        <div>
          {step === "addons" && (
            <StepAddOns
              product={product}
              selectedAddOns={selectedAddOns}
              onAddOnsChange={setSelectedAddOns}
              onContinue={() => setStep("details")}
            />
          )}
          {step === "details" && (
            <StepDetails
              date={date}
              time={time}
              places={places}
              airportName={flight.airportName}
              adults={adults}
              children={children}
              contact={contact}
              flight={flight}
              travelers={travelers}
              onContactChange={setContact}
              onFlightChange={setFlight}
              onTravelersChange={setTravelers}
              onBack={() => setStep("addons")}
              onContinue={() => setStep(isTransport ? "signature" : "payment")}
              isTransport={isTransport}
              identity={identity}
              onIdentityChange={setIdentity}
            />
          )}
          {step === "signature" && isTransport && (
            <div>
              <h2 className="mb-4 text-xl font-bold text-ink">
                {t("wizard.signature.title")}
              </h2>
              <SignaturePad value={signatureUrl} onChange={setSignatureUrl} />
              <div className="mt-8 flex justify-between">
                <button
                  onClick={() => setStep("details")}
                  className="rounded-xl border border-line bg-white px-6 py-3 text-base font-bold text-ink transition-colors hover:bg-canvas"
                >
                  {t("wizard.details.back")}
                </button>
                <button
                  onClick={() => setStep("payment")}
                  disabled={!signatureUrl}
                  className="rounded-xl bg-brand px-8 py-3 text-base font-bold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("wizard.details.continueToPayment")}
                </button>
              </div>
            </div>
          )}
          {step === "payment" && (
            <StepPayment
              onSubmit={handlePay}
              onBack={() => setStep(isTransport ? "signature" : "details")}
              isSubmitting={isSubmitting}
              error={submitError}
              subtotalUsdCents={Math.round(total * 100)}
              appliedPromo={appliedPromo}
              onPromoChange={setAppliedPromo}
            />
          )}
        </div>

        <aside className="mt-8 lg:mt-0">
            <BookingSummary
              product={product}
              date={date}
              time={time}
              adults={adults}
              children={children}
              infants={infants}
              units={
                selectedPackage?.unitKind === "per_unit"
                  ? qtyParam
                  : selectedPackage?.unitKind === "per_day"
                    ? daysParam
                    : undefined
              }
              packageLabel={selectedPackage?.label ?? ""}
              addOns={addOnsWithLabels}
              discountUsdCents={appliedPromo?.discountUsdCents ?? 0}
              promoCode={appliedPromo?.code ?? null}
            />
        </aside>
      </div>
    </div>
  );
}

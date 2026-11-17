"use client";

// The shared checkout card — the payment form of `/pay/[code]`, of the
// booking wizard's payment step and of the transport / tour result screens.
//
// Layout follows the hosted-checkout look: a "Payment / all transactions are
// secure and encrypted" head, an optional failure banner, one grouped radio
// list that mixes the signed-in customer's SAVED CARDS (masked, CVV-only)
// with the gateway methods, the PayPal express button and the Pay now CTA.

import { useEffect, useMemo, useState } from "react";
import { getPaymentMethods } from "@/app/actions/catalog";
import {
  listSavedCards,
  saveSavedCard,
  type SavedCardDTO,
} from "@/app/actions/account";
import { useLocale } from "@/components/providers/LocaleProvider";
import { PaymentBrandIcon, type PaymentBrand } from "@/components/icons";
import PaymentMethodPicker, {
  type PaymentMethodOption,
} from "./PaymentMethodPicker";
import PayPalPayButton from "./PayPalPayButton";

/** What the customer picked — a gateway method or one of their cards. */
export type PayIntent =
  | { kind: "method"; methodCode: string }
  | { kind: "savedCard"; cardId: string; cvv: string };

type Props = {
  onPay: (intent: PayIntent) => void | Promise<void>;
  onBack?: () => void;
  backLabel?: string;
  isSubmitting?: boolean;
  /** The red banner of a failed / expired attempt (checkout style). */
  banner?: "failed" | "expired" | null;
  /** Hide the "Payment / secure" head when embedded in a bigger step. */
  showHeader?: boolean;
  payLabel?: string;
};

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

/** Masked label of a saved card — only the last four digits are known. */
function cardLabel(card: SavedCardDTO): string {
  const brand = card.brandLabel || "Card";
  const exp = `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`;
  return `${brand} •••• •••• •••• ${card.last4} · ${exp}`;
}

/** The hosted icon of a stored brand, when the brand has one. */
function brandIcon(brand: string): PaymentBrand | null {
  switch (brand) {
    case "visa":
    case "mastercard":
    case "amex":
    case "jcb":
    case "discover":
      return brand;
    default:
      return null;
  }
}

export default function PaymentForm({
  onPay,
  onBack,
  backLabel,
  isSubmitting = false,
  banner = null,
  showHeader = true,
  payLabel,
}: Props) {
  const { t } = useLocale();

  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [cards, setCards] = useState<SavedCardDTO[]>([]);
  const [loaded, setLoaded] = useState(false);

  // "saved" or a method code.
  const [selected, setSelected] = useState<string>("");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [cvv, setCvv] = useState("");
  const [cvvError, setCvvError] = useState<string | null>(null);

  // The add-card modal.
  const [addingCard, setAddingCard] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardMonth, setCardMonth] = useState("");
  const [cardYear, setCardYear] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);
  const [savingCard, setSavingCard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPaymentMethods(), listSavedCards()]).then(([list, saved]) => {
      if (cancelled) return;
      setMethods(list);
      setCards(saved);
      const pickable = list.filter((m) => m.code !== "PAYPAL");
      // Saved cards win the default selection when they exist.
      if (saved.length > 0) {
        setSelected("saved");
        setSelectedCardId(saved.find((c) => c.isDefault)?.id ?? saved[0]!.id);
      } else if (pickable.length > 0) {
        setSelected(pickable[0]!.code);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pickableMethods = methods.filter((m) => m.code !== "PAYPAL");
  const paypalAvailable = methods.some((m) => m.code === "PAYPAL");
  const usingSavedCard = selected === "saved" && cards.length > 0;

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  );

  const pay = async (intent?: PayIntent) => {
    if (isSubmitting) return;
    if (intent) {
      await onPay(intent);
      return;
    }
    if (usingSavedCard) {
      if (!/^\d{3,4}$/.test(cvv.trim())) {
        setCvvError(t("payment.cvvRequired"));
        return;
      }
      setCvvError(null);
      await onPay({ kind: "savedCard", cardId: selectedCardId, cvv: cvv.trim() });
      return;
    }
    if (selected && selected !== "saved") {
      await onPay({ kind: "method", methodCode: selected });
    }
  };

  const submitNewCard = async () => {
    if (savingCard) return;
    setSavingCard(true);
    setCardError(null);
    const result = await saveSavedCard({
      number: cardNumber,
      expMonth: Number(cardMonth),
      expYear: Number(cardYear),
      holderName: cardName,
    });
    setSavingCard(false);
    if (!result.ok) {
      setCardError(result.error);
      return;
    }
    const refreshed = await listSavedCards();
    setCards(refreshed);
    setSelected("saved");
    setSelectedCardId(result.data?.id ?? selectedCardId);
    setAddingCard(false);
    setCardNumber("");
    setCardMonth("");
    setCardYear("");
    setCardName("");
  };

  return (
    <div className="rounded-2xl border border-line bg-white p-5 md:p-6">
      {showHeader ? (
        <>
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-ink">
            {t("payment.title")}
          </h2>
          <p className="mt-1 text-[13px] text-muted">{t("payment.secure")}</p>
        </>
      ) : null}

      {banner ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-3 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3.5"
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-danger text-danger">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M12 7v6M12 17h.01" />
            </svg>
          </span>
          <p className="text-[13px] leading-relaxed text-ink">
            {banner === "expired" ? t("payment.expiredBanner") : t("payment.failedBanner")}
          </p>
        </div>
      ) : null}

      {!loaded ? (
        <p className="mt-4 text-[13px] text-muted">Memuat metode pembayaran…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {/* Saved cards — masked select + CVV only. */}
          {cards.length > 0 ? (
            <div
              className={`overflow-hidden rounded-xl border transition-colors ${
                usingSavedCard ? "border-brand bg-brand-soft/40" : "border-line bg-white"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={usingSavedCard}
                disabled={isSubmitting}
                onClick={() => setSelected("saved")}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    usingSavedCard ? "border-brand" : "border-line"
                  }`}
                >
                  {usingSavedCard ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-brand" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">
                  {t("payment.savedCards")}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {selectedCard && brandIcon(selectedCard.brand) ? (
                    <PaymentBrandIcon brand={brandIcon(selectedCard.brand)!} height={16} />
                  ) : null}
                </span>
              </button>

              {usingSavedCard ? (
                <div className="space-y-3 border-t border-line/70 bg-white px-4 py-4">
                  <select
                    className={INPUT_CLASS}
                    value={selectedCardId}
                    disabled={isSubmitting}
                    onChange={(e) => setSelectedCardId(e.target.value)}
                    aria-label={t("payment.savedCards")}
                  >
                    {cards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {cardLabel(card)}
                      </option>
                    ))}
                  </select>

                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block w-32">
                      <span className="mb-1.5 block text-[12px] font-medium text-ink">
                        {t("payment.savedCardCvv")}
                      </span>
                      <input
                        className={INPUT_CLASS}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={4}
                        type="password"
                        placeholder="•••"
                        value={cvv}
                        disabled={isSubmitting}
                        onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))}
                      />
                    </label>
                    <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted">
                      {t("payment.savedCardCvvHint")}
                    </p>
                  </div>
                  {cvvError ? (
                    <p className="text-[12px] text-danger">{cvvError}</p>
                  ) : null}

                  <button
                    type="button"
                    className="text-[12px] font-semibold text-brand hover:underline"
                    onClick={() => setAddingCard(true)}
                  >
                    + {t("payment.addCard")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Gateway methods. */}
          {pickableMethods.length > 0 ? (
            <PaymentMethodPicker
              methods={pickableMethods}
              selected={usingSavedCard ? "" : selected}
              onSelect={(code) => {
                setSelected(code);
                setCvvError(null);
              }}
              disabled={isSubmitting}
            />
          ) : null}

          {cards.length === 0 && pickableMethods.length === 0 ? (
            <p className="rounded-xl border border-line bg-canvas p-4 text-[13px] text-muted">
              Belum ada metode pembayaran yang tersedia.
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={isSubmitting}
            className="inline-flex h-11 items-center justify-center gap-1 rounded-xl px-2 text-[13px] font-semibold text-brand transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
            {backLabel ?? t("payment.backToInfo")}
          </button>
        ) : (
          <span />
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {paypalAvailable ? (
            <PayPalPayButton
              onPay={() => void pay({ kind: "method", methodCode: "PAYPAL" })}
              busy={isSubmitting}
              disabled={!loaded}
            />
          ) : null}
          <button
            type="button"
            onClick={() => void pay()}
            disabled={!loaded || isSubmitting || (!usingSavedCard && !selected)}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-8 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? t("payment.processing") : (payLabel ?? t("payment.payNow"))}
          </button>
        </div>
      </div>

      {/* Add-card modal — number/exp/name only, the CVV is never stored. */}
      {addingCard ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-[420px] rounded-2xl border border-line bg-white p-5 shadow-xl">
            <h3 className="text-[15px] font-bold text-ink">{t("payment.addCardTitle")}</h3>
            <p className="mt-1 text-[12px] text-muted">{t("payment.addCardDesc")}</p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink">
                  {t("payment.cardNumber")}
                </span>
                <input
                  className={INPUT_CLASS}
                  inputMode="numeric"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="4111 1111 1111 1111"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink">
                    {t("payment.cardExpiry")}
                  </span>
                  <div className="flex gap-2">
                    <select
                      className={INPUT_CLASS}
                      value={cardMonth}
                      onChange={(e) => setCardMonth(e.target.value)}
                    >
                      <option value="">MM</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>
                          {String(m).padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                    <select
                      className={INPUT_CLASS}
                      value={cardYear}
                      onChange={(e) => setCardYear(e.target.value)}
                    >
                      <option value="">YY</option>
                      {Array.from({ length: 12 }, (_, i) => new Date().getFullYear() + i).map(
                        (y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink">
                    {t("payment.cardName")}
                  </span>
                  <input
                    className={INPUT_CLASS}
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    placeholder="—"
                  />
                </label>
              </div>

              {cardError ? <p className="text-[12px] text-danger">{cardError}</p> : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas"
                onClick={() => setAddingCard(false)}
              >
                {t("payment.cancel")}
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-40"
                disabled={savingCard}
                onClick={() => void submitNewCard()}
              >
                {savingCard ? t("payment.processing") : t("payment.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

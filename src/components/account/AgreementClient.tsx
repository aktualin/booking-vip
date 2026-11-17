"use client";

// The signed rental agreement sheet — the frozen articles as they were
// signed, the signer name, the signature image and the signing date.
// Ownership is proven with the contact email (the invoice rule); the
// account email or the browser's last-booking email fills it in.

import { useCallback, useEffect, useState } from "react";
import {
  getSignedContractByCode,
  type SignedContractDTO,
} from "@/app/actions/contract";
import type { BrandInfo } from "@/lib/branding";
import { useAccountOverview } from "@/components/providers/AccountProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import BrandWordmark from "@/components/layout/BrandWordmark";
import PrintInvoiceButton from "@/components/account/PrintInvoiceButton";

const LAST_BOOKING_KEY = "booking-vip:last-booking";

export default function AgreementClient({
  code,
  brand,
}: {
  code: string;
  brand: BrandInfo;
}) {
  const { t, lang } = useLocale();
  const { overview } = useAccountOverview();

  const [email, setEmail] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [contract, setContract] = useState<SignedContractDTO | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_BOOKING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { code?: string; email?: string };
        if (parsed.code === code && parsed.email) {
          setEmail(parsed.email);
          return;
        }
      }
    } catch {
      // Storage unavailable — the account email below takes over.
    }
  }, [code]);

  useEffect(() => {
    if (!email && overview?.email) setEmail(overview.email);
  }, [email, overview]);

  const load = useCallback(async (address: string) => {
    const dto = await getSignedContractByCode({ bookingCode: code, email: address });
    setContract(dto);
    setLoaded(true);
  }, [code]);

  useEffect(() => {
    if (!email) return;
    void load(email);
  }, [email, load]);

  if (!email) {
    return (
      <div className="rounded-2xl border border-line bg-white p-6 md:p-8">
        <h1 className="text-[18px] font-bold text-ink">{t("agreement.title")}</h1>
        <p className="mt-2 text-[13px] text-muted">{t("payment.emailGate")}</p>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            setEmail(emailInput.trim().toLowerCase());
          }}
        >
          <input
            type="email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder={t("payment.emailPlaceholder")}
            className="h-11 flex-1 rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
          />
          <button
            type="submit"
            className="h-11 rounded-xl bg-brand px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            {t("payment.continue")}
          </button>
        </form>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="h-72 animate-pulse rounded-2xl bg-white" aria-hidden="true" />
    );
  }

  if (!contract) {
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center text-[13px] text-muted">
        {t("agreement.notFound")}
      </div>
    );
  }

  const dateLocale = lang === "id" ? "id-ID" : "en-US";

  return (
    <div>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintInvoiceButton label={t("agreement.print")} />
      </div>

      <article className="rounded-2xl border border-line bg-white p-6 print:rounded-none print:border-0 print:p-0 md:p-10">
        <header className="flex flex-col items-center border-b border-line pb-6 text-center">
          <BrandWordmark brand={brand} dark />
          <h1 className="mt-4 text-[16px] font-bold tracking-[-0.01em] text-ink">
            {t("agreement.title")}
          </h1>
          <p className="mt-1 font-mono text-[12.5px] text-muted">{contract.bookingCode}</p>
        </header>

        <div className="mt-6 space-y-5">
          {contract.clauses.map((clause, index) => (
            <section key={clause.id || index}>
              <h2 className="text-[13px] font-bold text-ink">
                {t("wizard.agreement.article", { n: index + 1 })} — {clause.title}
              </h2>
              <div className="mt-1.5 space-y-1.5">
                {clause.body.split(/\n+/).map((paragraph, i) => (
                  <p key={i} className="text-[12.5px] leading-relaxed text-muted">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-8 grid gap-6 border-t border-line pt-6 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
              {t("agreement.signer")}
            </p>
            <p className="mt-1 text-[13px] font-semibold text-ink">{contract.signerName}</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {t("agreement.signedOn", {
                date: new Date(contract.signedAt).toLocaleDateString(dateLocale, {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                }),
              })}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
              {t("wizard.agreement.signature")}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={contract.signatureUrl}
              alt={contract.signerName}
              className="mt-2 inline-block h-24 rounded-lg border border-line bg-white object-contain p-2"
            />
          </div>
        </footer>
      </article>
    </div>
  );
}

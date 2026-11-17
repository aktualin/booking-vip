"use client";

// The controlled fields of the rental agreement: the article list (English
// content from the admin area, rendered as-is and numbered), the consent
// checkbox, the signer name and the signature pad. Shared by the booking
// wizard's agreement step and the transport cart flow.

import { useLocale } from "@/components/providers/LocaleProvider";
import type { ContractClauseDTO } from "@/app/actions/contract";
import SignaturePad from "./SignaturePad";

type Props = {
  clauses: ContractClauseDTO[];
  signerName: string;
  onSignerNameChange: (value: string) => void;
  agreed: boolean;
  onAgreedChange: (value: boolean) => void;
  signatureUrl: string | null;
  onSignatureChange: (value: string | null) => void;
};

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand";

export default function ContractAgreementFields({
  clauses,
  signerName,
  onSignerNameChange,
  agreed,
  onAgreedChange,
  signatureUrl,
  onSignatureChange,
}: Props) {
  const { t } = useLocale();

  return (
    <div>
      {/* The articles — English content, rendered as-is, numbered. */}
      <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-line bg-white p-5">
        {clauses.length === 0 ? (
          <p className="text-[13px] text-muted">{t("wizard.agreement.empty")}</p>
        ) : (
          <div className="space-y-5">
            {clauses.map((clause, index) => (
              <section key={clause.id}>
                <h3 className="text-[13px] font-bold text-ink">
                  {t("wizard.agreement.article", { n: index + 1 })} — {clause.title}
                </h3>
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
        )}
      </div>

      {/* Consent + signer */}
      <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-white p-3.5">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => onAgreedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span className="text-[13px] leading-relaxed text-ink">
          {t("wizard.agreement.agree")}
        </span>
      </label>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink">
            {t("wizard.agreement.signerName")}
          </span>
          <input
            className={INPUT_CLASS}
            value={signerName}
            onChange={(e) => onSignerNameChange(e.target.value)}
            placeholder="—"
          />
        </label>
        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-ink">
            {t("wizard.agreement.signature")}
          </span>
          <SignaturePad value={signatureUrl} onChange={onSignatureChange} />
        </div>
      </div>
    </div>
  );
}

"use client";

// The AGREEMENT step of the transport booking wizard: the shared agreement
// fields (articles + consent + signer + signature pad) plus the step's
// heading and navigation buttons. The wizard sends the signature and the
// signer name with the booking creation; the server snapshots the articles
// into a SignedContract row.

import { useLocale } from "@/components/providers/LocaleProvider";
import type { ContractClauseDTO } from "@/app/actions/contract";
import ContractAgreementFields from "./ContractAgreementFields";

type Props = {
  clauses: ContractClauseDTO[];
  signerName: string;
  onSignerNameChange: (value: string) => void;
  agreed: boolean;
  onAgreedChange: (value: boolean) => void;
  signatureUrl: string | null;
  onSignatureChange: (value: string | null) => void;
  onBack: () => void;
  onContinue: () => void;
};

export default function ContractAgreementStep(props: Props) {
  const { t } = useLocale();
  const { onBack, onContinue } = props;

  const complete =
    props.agreed && !!props.signatureUrl && props.signerName.trim().length > 1;

  return (
    <div>
      <h2 className="mb-2 text-xl font-bold text-ink">{t("wizard.agreement.title")}</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-muted">
        {t("wizard.agreement.intro")}
      </p>

      <ContractAgreementFields {...props} />

      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="rounded-xl border border-line bg-white px-6 py-3 text-base font-bold text-ink transition-colors hover:bg-canvas"
        >
          {t("wizard.details.back")}
        </button>
        <button
          onClick={onContinue}
          disabled={!complete}
          className="rounded-xl bg-brand px-8 py-3 text-base font-bold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("wizard.agreement.continue")}
        </button>
      </div>
    </div>
  );
}

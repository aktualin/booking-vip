"use client";

import { useLocale } from "@/components/providers/LocaleProvider";

/** Trigger the browser print dialog (the page is styled for printing). */
export default function PrintInvoiceButton({ label }: { label?: string }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center justify-center rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
    >
      {label ?? t("invoice.print")}
    </button>
  );
}

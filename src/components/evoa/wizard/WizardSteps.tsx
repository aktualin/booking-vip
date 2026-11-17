"use client";

import type { Lang } from "./shared";

/**
 * The wizard progress indicator: 1 Perjalanan → 2 Pemohon → 3 Tambahan →
 * 4 Review. Completed steps are clickable to go back; future steps are not
 * (validation gates forward movement).
 */

const STEP_LABELS: { en: string; id: string }[] = [
  { en: "Travel", id: "Perjalanan" },
  { en: "Applicants", id: "Pemohon" },
  { en: "Extras", id: "Tambahan" },
  { en: "Review", id: "Review" },
];

type Props = {
  step: number;
  lang: Lang;
  onBack: (step: number) => void;
};

export default function WizardSteps({ step, lang, onBack }: Props) {
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2">
      {STEP_LABELS.map((label, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <li key={label.en} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={!done}
              onClick={() => done && onBack(index)}
              aria-current={active ? "step" : undefined}
              className={`flex min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 text-left transition-colors sm:px-2 ${
                done ? "cursor-pointer hover:bg-canvas" : "cursor-default"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  done
                    ? "bg-brand text-white"
                    : active
                      ? "bg-brand-soft text-brand-dark ring-1 ring-brand"
                      : "bg-canvas text-muted"
                }`}
              >
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="m5 13 4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={`hidden truncate text-[12px] font-semibold sm:block ${
                  active ? "text-ink" : done ? "text-ink" : "text-muted"
                }`}
              >
                {lang === "id" ? label.id : label.en}
              </span>
            </button>
            {index < STEP_LABELS.length - 1 ? (
              <span className={`h-px flex-1 ${done ? "bg-brand" : "bg-line"}`} aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
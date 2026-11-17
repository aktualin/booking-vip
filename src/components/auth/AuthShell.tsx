import type { ReactNode } from "react";
import LocaleMenu from "@/components/layout/LocaleMenu";

/**
 * The centered canvas used by the login and register pages.
 *
 * A plain white page with a single centered column: a small brand plane icon
 * on top, then the page content (heading, form, SSO buttons). Deliberately
 * without the site header/footer — these pages are a focused,
 * distraction-free step. The only exception is the language switcher,
 * pinned to the top-right corner since there is no navbar to host it.
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-white px-4 py-10">
      <div className="absolute right-4 top-4 z-10 text-[13px] font-medium text-muted">
        <LocaleMenu />
      </div>
      <main className="w-full max-w-[380px]">
        <div className="mb-8 flex justify-center text-ink">
          <PlaneMark />
        </div>
        {children}
      </main>
    </div>
  );
}

/** The Booking VIP plane mark — icon only, no wordmark. */
function PlaneMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16Z"
      />
    </svg>
  );
}

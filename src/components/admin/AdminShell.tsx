import AdminSidebar from "./AdminSidebar";
import AdminTopbar from "./AdminTopbar";
import { AdminToaster } from "./toast";
import { AdminSessionRefresh } from "@/components/providers/SessionRefresh";

/**
 * Admin shell — sidebar + topbar + content.
 *
 * The admin area has its own structure: it never reuses the public site
 * `Header` / `Footer` / `Container`.
 *
 * The shell is locked to the viewport height and each column scrolls on its
 * own, so the sidebar and the topbar stay put while only the page content
 * moves. The sidebar keeps its own scrollbar for when the menu is taller than
 * the screen.
 *
 * `AdminSessionRefresh` keeps the operator's session cookie alive while the
 * tab is visible (sliding expiration). It is a client component that renders
 * nothing, so it is safe inside the Suspense-guarded admin layout.
 */
export default function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden bg-white text-[var(--admin-ink)]">
      <AdminSidebar />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <AdminTopbar email={email} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 sm:py-7">
          {children}
        </main>
      </div>
      <AdminToaster />
      <AdminSessionRefresh />
    </div>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";
import VehiclesForm from "../VehiclesForm";

export const metadata: Metadata = {
  title: "Edit Vehicle · Admin",
  robots: { index: false, follow: false },
};

/**
 * The edit page of the Vehicle roster.
 *
 * The record id comes from the URL, so it is read inside a `<Suspense>`
 * boundary: with Cache Components enabled a URL read outside a boundary
 * blocks the instant navigation shell.
 */
export default function AdminVehiclesEditPage(
  props: PageProps<"/admin/roster/vehicles/[id]">
) {
  return (
    <Suspense fallback={<AdminVehiclesEditFallback />}>
      <AdminVehiclesEditForm {...props} />
    </Suspense>
  );
}

/** Reads the id and renders the form. */
async function AdminVehiclesEditForm(
  props: PageProps<"/admin/roster/vehicles/[id]">
) {
  const { id } = await props.params;
  return <VehiclesForm mode="edit" id={id} />;
}

/** Shown while the id is being resolved. */
function AdminVehiclesEditFallback() {
  return (
    <div className="rounded-lg border border-[var(--admin-line)] px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]">
      Memuat data…
    </div>
  );
}

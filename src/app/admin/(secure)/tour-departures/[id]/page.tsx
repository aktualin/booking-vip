import { Suspense } from "react";
import type { Metadata } from "next";
import DeparturesForm from "../DeparturesForm";

export const metadata: Metadata = {
  title: "Edit Jadwal · Admin",
  robots: { index: false, follow: false },
};

/**
 * The edit page of a join-in departure. The id comes from the URL, so it is
 * read inside a `<Suspense>` boundary (Cache Components rule).
 */
export default function AdminTourDeparturesEditPage(
  props: PageProps<"/admin/tour-departures/[id]">
) {
  return (
    <Suspense fallback={<EditFallback />}>
      <EditLoader {...props} />
    </Suspense>
  );
}

async function EditLoader(props: PageProps<"/admin/tour-departures/[id]">) {
  const { id } = await props.params;
  return <DeparturesForm mode="edit" id={id} />;
}

function EditFallback() {
  return (
    <div className="rounded-lg border border-[var(--admin-line)] px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]">
      Memuat data…
    </div>
  );
}

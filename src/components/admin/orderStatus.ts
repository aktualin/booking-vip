import { adminClass } from "./tokens";

/**
 * Status vocabularies of the Airport VIP order back-office.
 *
 * The DB columns are plain strings; the labels here are the Indonesian copy
 * the operator sees. Kept out of the "use server" action module because that
 * module may only export async functions (and types).
 */

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Menunggu pembayaran",
  confirmed: "Dibayar",
  cancelled: "Dibatalkan",
  completed: "Selesai",
};

/** The operational workflow, in order. */
export const OPS_STATUS_FLOW = [
  { value: "waiting_documents", label: "Menunggu dokumen" },
  { value: "processing", label: "Diproses" },
  { value: "ready", label: "Siap" },
  { value: "in_service", label: "Layanan berjalan" },
  { value: "done", label: "Selesai" },
] as const;

export const OPS_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  OPS_STATUS_FLOW.map((s) => [s.value, s.label]),
);

export const DOC_STATUS_OPTIONS = [
  { value: "pending", label: "Menunggu" },
  { value: "received", label: "Diterima" },
  { value: "processing", label: "Diproses" },
  { value: "ready", label: "Siap" },
  { value: "issue", label: "Bermasalah" },
] as const;

export const DOC_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  DOC_STATUS_OPTIONS.map((s) => [s.value, s.label]),
);

export const VISA_STATUS_OPTIONS = [
  { value: "submitted", label: "Diajukan" },
  { value: "processing", label: "Diproses" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Ditolak" },
] as const;

export const VISA_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  VISA_STATUS_OPTIONS.map((s) => [s.value, s.label]),
);

/** Payment attempt status (the `Payment.status` column). */
export const PAYMENT_ATTEMPT_LABELS: Record<string, string> = {
  pending: "Menunggu",
  paid: "Dibayar",
  failed: "Gagal",
  refunded: "Dikembalikan",
};

export const TRAVELER_KIND_LABELS: Record<string, string> = {
  adult: "Dewasa",
  child: "Anak",
  infant: "Bayi",
};

export const DIRECTION_LABELS: Record<string, string> = {
  arrival: "Kedatangan",
  departure: "Keberangkatan",
};

/**
 * Badge classes — the admin area is monochrome by design, so emphasis comes
 * from weight and the danger tone, not from coloured fills.
 */
export function paymentStatusBadge(status: string): string {
  const tone =
    status === "cancelled"
      ? "text-[var(--admin-muted)]"
      : status === "awaiting_payment"
        ? "text-[var(--admin-muted)]"
        : "text-[var(--admin-ink)]";
  return `${adminClass.pill} ${tone}`;
}

export function opsStatusBadge(status: string): string {
  const tone =
    status === "done" || status === "ready"
      ? "text-[var(--admin-ink)]"
      : "text-[var(--admin-muted)]";
  return `${adminClass.pill} ${tone}`;
}

export function docStatusBadge(status: string): string {
  const tone =
    status === "issue"
      ? "border-danger/40 text-danger"
      : status === "ready"
        ? "text-[var(--admin-ink)]"
        : "text-[var(--admin-muted)]";
  return `${adminClass.pill} ${tone}`;
}

export function visaStatusBadge(status: string): string {
  const tone =
    status === "rejected"
      ? "border-danger/40 text-danger"
      : status === "approved"
        ? "text-[var(--admin-ink)]"
        : "text-[var(--admin-muted)]";
  return `${adminClass.pill} ${tone}`;
}

export function paymentAttemptBadge(status: string): string {
  const tone =
    status === "failed"
      ? "border-danger/40 text-danger"
      : status === "paid"
        ? "text-[var(--admin-ink)]"
        : "text-[var(--admin-muted)]";
  return `${adminClass.pill} ${tone}`;
}

/** "17 Nov 2026, 08.30" — the admin schedule format (id-ID). */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** "17 Nov 2026" — dates without a time (DOB, expiry, arrival). */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Immigration rule: the passport must stay valid at least 6 months after the
 * service date. Returns true when the expiry is too close (or already past).
 */
export function passportExpiryTooSoon(
  expiryIso: string | null,
  serviceAtIso: string,
): boolean {
  if (!expiryIso) return false;
  const expiry = new Date(expiryIso);
  const service = new Date(serviceAtIso);
  if (Number.isNaN(expiry.getTime()) || Number.isNaN(service.getTime())) return false;
  const threshold = new Date(service);
  threshold.setMonth(threshold.getMonth() + 6);
  return expiry.getTime() < threshold.getTime();
}
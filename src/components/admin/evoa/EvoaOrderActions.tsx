"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  completeOrder,
  refundOrder,
  rejectOrder,
  requestOrderRevision,
  startProcessing,
  type EvoaAdminResult,
  type EvoaOrderAdminDTO,
} from "@/app/actions/evoa-admin";
import { showAdminToast } from "@/components/admin/toast";

/**
 * Order-level workflow actions.
 *
 * Each button is only offered in the states the server action accepts, so
 * the UI and the transition guards agree. Destructive / note-carrying
 * actions open a small inline panel instead of a browser prompt.
 */

type Panel = "process" | "revision" | "reject" | "refund" | null;

const REVISABLE = ["paid", "review", "revision", "processing", "submitted", "approved"];
const PROCESSABLE = ["paid", "review", "revision"];
const REFUNDABLE = ["paid", "review", "revision", "processing", "issued", "completed", "rejected"];

const BTN_PRIMARY =
  "inline-flex h-9 items-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50";
const BTN_SECONDARY =
  "inline-flex h-9 items-center rounded-xl border border-line bg-white px-4 text-[13px] font-medium text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50";
const BTN_DANGER =
  "inline-flex h-9 items-center rounded-xl border border-red-200 bg-white px-4 text-[13px] font-medium text-danger transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function EvoaOrderActions({ order }: { order: EvoaOrderAdminDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [ref, setRef] = useState(order.officialTransactionRef ?? "");
  const [note, setNote] = useState("");

  const allIssued =
    order.applicants.length > 0 &&
    order.applicants.every((person) => person.status === "issued");

  const canProcess = PROCESSABLE.includes(order.status);
  const canRevise = REVISABLE.includes(order.status);
  const canComplete =
    allIssued && (order.status === "processing" || order.status === "issued");
  const canReject =
    !["completed", "rejected", "refunded", "expired", "draft", "awaiting_payment"].includes(
      order.status,
    );
  const canRefund = REFUNDABLE.includes(order.status);

  /** Run one action, toast the outcome and refresh the server data. */
  const run = async (
    key: string,
    action: () => Promise<EvoaAdminResult>,
    successMessage: string,
  ) => {
    if (busy) return;
    setBusy(key);
    const result = await action();
    setBusy(null);
    if (result.ok) {
      showAdminToast(successMessage);
      setPanel(null);
      setNote("");
      router.refresh();
    } else {
      showAdminToast(result.error, "error");
    }
  };

  const openPanel = (next: Panel) => {
    setNote("");
    setPanel((current) => (current === next ? null : next));
  };

  const submitNote = (
    key: string,
    action: (note: string) => Promise<EvoaAdminResult>,
    successMessage: string,
  ) => {
    if (!note.trim()) {
      showAdminToast("Tulis catatan dulu.", "error");
      return;
    }
    void run(key, () => action(note.trim()), successMessage);
  };

  const noActions = !canProcess && !canRevise && !canComplete && !canReject && !canRefund;

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ink">
        Aksi pesanan
      </h2>

      {noActions ? (
        <p className="mt-2 text-[13px] text-muted">
          Tidak ada aksi yang tersedia untuk status ini.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canProcess ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => openPanel("process")}
              className={BTN_PRIMARY}
            >
              Mulai proses
            </button>
          ) : null}
          {canRevise ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => openPanel("revision")}
              className={BTN_SECONDARY}
            >
              Minta revisi
            </button>
          ) : null}
          {canComplete ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm("Tandai pesanan ini selesai?")) {
                  void run("complete", () => completeOrder(order.id), "Pesanan ditandai selesai.");
                }
              }}
              className={BTN_PRIMARY}
            >
              {busy === "complete" ? "Menyimpan…" : "Tandai selesai"}
            </button>
          ) : null}
          {canReject ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => openPanel("reject")}
              className={BTN_DANGER}
            >
              Tolak
            </button>
          ) : null}
          {canRefund ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => openPanel("refund")}
              className={BTN_DANGER}
            >
              Refund
            </button>
          ) : null}
        </div>
      )}

      {panel === "process" ? (
        <div className="mt-3 rounded-xl border border-line bg-canvas p-3">
          <label className="block text-[12px] font-medium text-ink">
            Ref transaksi portal resmi (opsional)
            <input
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder="Contoh: 20260812-XXXX-XXXX"
              className="mt-1.5 h-10 w-full rounded-xl border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
            />
          </label>
          <p className="mt-1.5 text-[12px] text-muted">
            Semua pemohon yang belum terbit / ditolak ikut berstatus “Sedang
            diproses”.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "process",
                  () => startProcessing(order.id, ref.trim() || undefined),
                  "Pesanan mulai diproses.",
                )
              }
              className={BTN_PRIMARY}
            >
              {busy === "process" ? "Menyimpan…" : "Mulai proses"}
            </button>
            <button type="button" onClick={() => setPanel(null)} className={BTN_SECONDARY}>
              Batal
            </button>
          </div>
        </div>
      ) : null}

      {panel === "revision" || panel === "reject" || panel === "refund" ? (
        <div className="mt-3 rounded-xl border border-line bg-canvas p-3">
          <label className="block text-[12px] font-medium text-ink">
            {panel === "revision"
              ? "Catatan revisi untuk pemesan"
              : panel === "reject"
                ? "Alasan penolakan"
                : "Catatan refund"}
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder={
                panel === "revision"
                  ? "Contoh: tiket pulang belum terbaca, mohon unggah ulang…"
                  : panel === "reject"
                    ? "Contoh: paspor tidak memenuhi syarat masa berlaku…"
                    : "Contoh: refund via transfer BCA, ref …"
              }
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-brand"
            />
          </label>
          {panel === "refund" ? (
            <p className="mt-1.5 text-[12px] text-muted">
              Pengembalian dana dilakukan manual — catatan ini hanya
              dokumentasi, tidak memindahkan uang.
            </p>
          ) : null}
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (panel === "revision") {
                  submitNote(
                    "revision",
                    (value) => requestOrderRevision(order.id, value),
                    "Revisi pesanan diminta.",
                  );
                } else if (panel === "reject") {
                  submitNote(
                    "reject",
                    (value) => rejectOrder(order.id, value),
                    "Pesanan ditolak.",
                  );
                } else {
                  submitNote(
                    "refund",
                    (value) => refundOrder(order.id, value),
                    "Refund dicatat.",
                  );
                }
              }}
              className={panel === "revision" ? BTN_PRIMARY : BTN_DANGER}
            >
              {busy === panel ? "Menyimpan…" : "Kirim"}
            </button>
            <button type="button" onClick={() => setPanel(null)} className={BTN_SECONDARY}>
              Batal
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
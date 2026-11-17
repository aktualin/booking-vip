"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteContractClause,
  listContractClauses,
  moveContractClause,
  setContractClauseActive,
  upsertContractClause,
  type ContractClauseDTO,
} from "@/app/actions/admin-contract";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";

/**
 * The admin manager of the rental agreement articles ("pasal").
 *
 * The content is authored in English on purpose — the agreement the renter
 * signs in the booking wizard is an English contract and the public step
 * renders these rows as-is, numbered by `sortOrder`.
 */

type Draft = {
  id: string | null;
  title: string;
  body: string;
  active: boolean;
};

const EMPTY_DRAFT: Draft = { id: null, title: "", body: "", active: true };

export default function ContractClausesManager() {
  const [rows, setRows] = useState<ContractClauseDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await listContractClauses());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (action: Promise<{ ok: boolean; message?: string; error?: string }>) => {
    const result = await action;
    if (!result.ok) {
      showAdminToast(result.error ?? "Gagal.", "error");
      return false;
    }
    showAdminToast(result.message ?? "Tersimpan.", "success");
    await reload();
    return true;
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    const ok = await run(
      upsertContractClause({
        id: draft.id,
        title: draft.title,
        body: draft.body,
        active: draft.active,
      }),
    );
    setSaving(false);
    if (ok) setDraft(null);
  };

  return (
    <div className={adminClass.page}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={adminClass.h1}>Rental Agreement Articles</h1>
          <p className="mt-1 max-w-[640px] text-[13px] text-[var(--admin-muted)]">
            The articles of the transport rental agreement signed in the booking
            wizard. Write them in English — the signed contract is English and
            the public form renders this content as-is, numbered top to bottom.
          </p>
        </div>
        <button
          type="button"
          className={adminClass.buttonPrimary}
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
        >
          Add article
        </button>
      </div>

      <div className={`${adminClass.panel} mt-5 overflow-x-auto`}>
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className={adminClass.tableHead}>#</th>
              <th className={adminClass.tableHead}>Article</th>
              <th className={adminClass.tableHead}>Status</th>
              <th className={`${adminClass.tableHead} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr>
                <td colSpan={4} className={`${adminClass.tableCell} text-[var(--admin-muted)]`}>
                  Memuat…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className={`${adminClass.tableCell} text-[var(--admin-muted)]`}>
                  Belum ada pasal. Jalankan `npm run db:seed-contract` atau tambah manual.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row.id} className={adminClass.tableRow}>
                  <td className={`${adminClass.tableCell} font-mono text-[12px]`}>
                    {index + 1}
                  </td>
                  <td className={adminClass.tableCell}>
                    <p className="font-medium">{row.title}</p>
                    <p className="mt-0.5 line-clamp-2 max-w-[520px] whitespace-pre-line text-[12px] text-[var(--admin-muted)]">
                      {row.body}
                    </p>
                  </td>
                  <td className={adminClass.tableCell}>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() =>
                        void run(setContractClauseActive(row.id, !row.active))
                      }
                      className={`${adminClass.pill} ${row.active ? adminClass.pillOn : adminClass.pillOff}`}
                    >
                      {row.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className={`${adminClass.tableCell} text-right`}>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className={adminClass.buttonGhost}
                        disabled={busyId === row.id || index === 0}
                        onClick={() =>
                          void (async () => {
                            setBusyId(row.id);
                            await run(moveContractClause(row.id, "up"));
                            setBusyId(null);
                          })()
                        }
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={adminClass.buttonGhost}
                        disabled={busyId === row.id || index === rows.length - 1}
                        onClick={() =>
                          void (async () => {
                            setBusyId(row.id);
                            await run(moveContractClause(row.id, "down"));
                            setBusyId(null);
                          })()
                        }
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={adminClass.buttonGhost}
                        onClick={() =>
                          setDraft({
                            id: row.id,
                            title: row.title,
                            body: row.body,
                            active: row.active,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`${adminClass.buttonGhost} text-red-600`}
                        disabled={busyId === row.id}
                        onClick={() =>
                          void (async () => {
                            if (!window.confirm(`Hapus pasal "${row.title}"?`)) return;
                            setBusyId(row.id);
                            await run(deleteContractClause(row.id));
                            setBusyId(null);
                          })()
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 sm:p-8">
          <div className={`${adminClass.drawer} static max-h-full w-full max-w-[640px] rounded-lg border`}>
            <div className="flex items-center justify-between border-b border-[var(--admin-line)] px-5 py-4">
              <h2 className="text-[15px] font-semibold">
                {draft.id ? "Edit article" : "New article"}
              </h2>
              <button
                type="button"
                className={adminClass.buttonGhost}
                onClick={() => setDraft(null)}
              >
                Close
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <label className="block">
                <span className={adminClass.label}>Title (English)</span>
                <input
                  className={`${adminClass.input} mt-1.5`}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. Insurance, Damage and Liability"
                />
              </label>
              <label className="block">
                <span className={adminClass.label}>Body (English, one paragraph per line)</span>
                <textarea
                  className={`${adminClass.input} mt-1.5 h-[240px] resize-y py-2 leading-relaxed`}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  placeholder={"The Renter warrants that…\nSecond paragraph…"}
                />
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                Active — shown on the agreement step
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--admin-line)] px-5 py-4">
              <button
                type="button"
                className={adminClass.buttonSecondary}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={adminClass.buttonPrimary}
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Menyimpan…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createEvoaField,
  deleteEvoaField,
  listEvoaFieldsAdmin,
  setEvoaFieldActive,
  updateEvoaField,
  type EvoaFieldAdminDTO,
  type EvoaFieldInput,
} from "@/app/actions/evoa-fields";
import {
  EVOA_FIELD_SCOPES,
  EVOA_FIELD_TYPES,
  type EvoaFieldScope,
  type EvoaFieldType,
} from "@/lib/evoa-shared";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";

/**
 * The dynamic e-VOA form builder.
 *
 * Operators add extra questions on top of the standard visa form without a
 * deploy. The table lists every field (active or not); the inline panel
 * edits one field at a time. All writes go through the guarded admin
 * actions, which re-validate everything server-side.
 */

const TYPE_LABELS: Record<EvoaFieldType, string> = {
  text: "Teks",
  textarea: "Area teks",
  number: "Angka",
  date: "Tanggal",
  select: "Pilihan (select)",
  checkbox: "Kotak centang",
  file: "File",
};

const SCOPE_LABELS: Record<EvoaFieldScope, string> = {
  application: "Per pesanan",
  applicant: "Per pemohon",
};

/* ------------------------------------------------------------------ */
/* Editor draft state — inputs stay strings until save                 */
/* ------------------------------------------------------------------ */

type OptionDraft = { value: string; labelEn: string; labelId: string };

type EditorState = {
  /** null = creating a new field. */
  id: string | null;
  key: string;
  labelEn: string;
  labelId: string;
  type: EvoaFieldType;
  scope: EvoaFieldScope;
  required: boolean;
  active: boolean;
  options: OptionDraft[];
  showWhenField: string;
  showWhenEquals: string;
  maxFiles: string;
  placeholderEn: string;
  placeholderId: string;
  helpEn: string;
  helpId: string;
  sortOrder: string;
};

function emptyEditor(): EditorState {
  return {
    id: null,
    key: "",
    labelEn: "",
    labelId: "",
    type: "text",
    scope: "applicant",
    required: false,
    active: true,
    options: [],
    showWhenField: "",
    showWhenEquals: "",
    maxFiles: "1",
    placeholderEn: "",
    placeholderId: "",
    helpEn: "",
    helpId: "",
    sortOrder: "0",
  };
}

function editorFromField(field: EvoaFieldAdminDTO): EditorState {
  return {
    id: field.id,
    key: field.key,
    labelEn: field.labelEn,
    labelId: field.labelId ?? "",
    type: field.type,
    scope: field.scope,
    required: field.required,
    active: field.active,
    options: field.options.map((o) => ({
      value: o.value,
      labelEn: o.labelEn,
      labelId: o.labelId ?? "",
    })),
    showWhenField: field.showWhen?.field ?? "",
    showWhenEquals: field.showWhen?.equals ?? "",
    maxFiles: String(field.maxFiles ?? 1),
    placeholderEn: field.placeholderEn ?? "",
    placeholderId: field.placeholderId ?? "",
    helpEn: field.helpEn ?? "",
    helpId: field.helpId ?? "",
    sortOrder: String(field.sortOrder),
  };
}

/** Map the draft to the action payload. Empty optional texts are sent as-is;
 * the server trims them to null. NaN numbers fail server validation. */
function editorToInput(editor: EditorState): EvoaFieldInput {
  return {
    key: editor.key,
    labelEn: editor.labelEn,
    labelId: editor.labelId,
    type: editor.type,
    scope: editor.scope,
    required: editor.required,
    active: editor.active,
    options: editor.type === "select" ? editor.options : undefined,
    showWhen: editor.showWhenField.trim()
      ? { field: editor.showWhenField.trim(), equals: editor.showWhenEquals }
      : null,
    maxFiles: editor.type === "file" ? Number(editor.maxFiles) : null,
    placeholderEn: editor.placeholderEn,
    placeholderId: editor.placeholderId,
    helpEn: editor.helpEn,
    helpId: editor.helpId,
    sortOrder: Number(editor.sortOrder),
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function EvoaFieldsBuilder() {
  const [rows, setRows] = useState<EvoaFieldAdminDTO[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [editorFieldError, setEditorFieldError] = useState<string | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await listEvoaFieldsAdmin();
    if (result.ok) {
      setRows(result.data);
      setLoadError("");
    } else {
      setLoadError(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (changes: Partial<EditorState>) => {
    setEditor((prev) => (prev ? { ...prev, ...changes } : prev));
  };

  const openCreate = () => {
    setEditor(emptyEditor());
    setEditorError("");
    setEditorFieldError(undefined);
  };

  const openEdit = (field: EvoaFieldAdminDTO) => {
    setEditor(editorFromField(field));
    setEditorError("");
    setEditorFieldError(undefined);
  };

  const save = async () => {
    if (!editor || saving) return;
    setSaving(true);
    setEditorError("");
    setEditorFieldError(undefined);

    const input = editorToInput(editor);
    const result = editor.id
      ? await updateEvoaField(editor.id, input)
      : await createEvoaField(input);

    setSaving(false);
    if (!result.ok) {
      setEditorError(result.error);
      setEditorFieldError(result.field);
      showAdminToast(result.error, "error");
      return;
    }

    showAdminToast("Field berhasil disimpan.");
    setEditor(null);
    void load();
  };

  const remove = async (field: EvoaFieldAdminDTO) => {
    if (deletingId) return;
    const confirmed = window.confirm(
      `Hapus field "${field.key}"?\n\nKolom ini tidak akan tampil lagi di formulir. Jawaban yang sudah tersimpan tetap ada di data pesanan.`,
    );
    if (!confirmed) return;

    setDeletingId(field.id);
    const result = await deleteEvoaField(field.id);
    setDeletingId(null);
    if (result.ok) {
      showAdminToast("Field berhasil dihapus.");
      if (editor?.id === field.id) setEditor(null);
      void load();
    } else {
      showAdminToast(result.error, "error");
    }
  };

  const toggleActive = async (field: EvoaFieldAdminDTO) => {
    if (togglingId) return;
    setTogglingId(field.id);
    const result = await setEvoaFieldActive(field.id, !field.active);
    setTogglingId(null);
    if (result.ok) {
      void load();
    } else {
      showAdminToast(result.error, "error");
    }
  };

  const inputClass = (fieldKey: string) =>
    `${adminClass.input} mt-1 ${editorFieldError === fieldKey ? "border-danger" : ""}`;

  return (
    <div className="pb-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={adminClass.h1}>Form Dinamis e-VOA</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--admin-muted)]">
            Kolom tambahan di formulir pengajuan e-VOA, tanpa deploy. Field{" "}
            <strong>per pesanan</strong> diisi sekali untuk seluruh pengajuan;
            field <strong>per pemohon</strong> diisi untuk setiap orang.
          </p>
        </div>
        <button type="button" onClick={openCreate} className={adminClass.buttonPrimary}>
          Tambah field
        </button>
      </div>

      {loadError ? (
        <p className="mb-5 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-danger">
          {loadError}
        </p>
      ) : null}

      {editor ? (
        <div className={`${adminClass.panel} mb-5 p-5`}>
          <h2 className="text-[15px] font-semibold">
            {editor.id ? "Edit field" : "Tambah field"}
          </h2>

          {editorError ? (
            <p className="mt-3 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-danger">
              {editorError}
            </p>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={adminClass.label}>Key (mesin)</span>
              <input
                type="text"
                value={editor.key}
                // The key is the answers-map key and the document slot —
                // renaming it would orphan stored answers, so it locks
                // after creation.
                disabled={editor.id !== null}
                onChange={(e) => patch({ key: e.target.value })}
                placeholder="sponsor_name"
                className={`${inputClass("key")} disabled:cursor-not-allowed disabled:bg-[var(--admin-hover)] disabled:text-[var(--admin-muted)]`}
              />
            </label>
            <label className="block">
              <span className={adminClass.label}>Label (EN) *</span>
              <input
                type="text"
                value={editor.labelEn}
                onChange={(e) => patch({ labelEn: e.target.value })}
                placeholder="Sponsor name"
                className={inputClass("labelEn")}
              />
            </label>
            <label className="block">
              <span className={adminClass.label}>Label (ID)</span>
              <input
                type="text"
                value={editor.labelId}
                onChange={(e) => patch({ labelId: e.target.value })}
                placeholder="Nama sponsor"
                className={adminClass.input + " mt-1"}
              />
            </label>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={adminClass.label}>Jenis</span>
              <select
                value={editor.type}
                onChange={(e) => patch({ type: e.target.value as EvoaFieldType })}
                className={inputClass("type")}
              >
                {EVOA_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={adminClass.label}>Cakupan</span>
              <select
                value={editor.scope}
                onChange={(e) => patch({ scope: e.target.value as EvoaFieldScope })}
                className={inputClass("scope")}
              >
                {EVOA_FIELD_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABELS[scope]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={adminClass.label}>Urutan</span>
              <input
                type="number"
                min={0}
                value={editor.sortOrder}
                onChange={(e) => patch({ sortOrder: e.target.value })}
                className={inputClass("sortOrder")}
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={editor.required}
                onChange={(e) => patch({ required: e.target.checked })}
                className="h-4 w-4 accent-[var(--admin-accent)]"
              />
              Wajib diisi
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={editor.active}
                onChange={(e) => patch({ active: e.target.checked })}
                className="h-4 w-4 accent-[var(--admin-accent)]"
              />
              Aktif (tampil di formulir)
            </label>
          </div>

          {editor.type === "select" ? (
            <div className="mt-4 rounded-lg border border-[var(--admin-line)] p-3">
              <span className={adminClass.label}>Opsi pilihan *</span>
              <div className="mt-2 grid gap-2">
                {editor.options.map((opt, index) => (
                  <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                    <input
                      type="text"
                      value={opt.value}
                      onChange={(e) =>
                        patch({
                          options: editor.options.map((o, i) =>
                            i === index ? { ...o, value: e.target.value } : o,
                          ),
                        })
                      }
                      placeholder="value"
                      className={adminClass.input}
                    />
                    <input
                      type="text"
                      value={opt.labelEn}
                      onChange={(e) =>
                        patch({
                          options: editor.options.map((o, i) =>
                            i === index ? { ...o, labelEn: e.target.value } : o,
                          ),
                        })
                      }
                      placeholder="Label (EN)"
                      className={adminClass.input}
                    />
                    <input
                      type="text"
                      value={opt.labelId}
                      onChange={(e) =>
                        patch({
                          options: editor.options.map((o, i) =>
                            i === index ? { ...o, labelId: e.target.value } : o,
                          ),
                        })
                      }
                      placeholder="Label (ID)"
                      className={adminClass.input}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        patch({ options: editor.options.filter((_, i) => i !== index) })
                      }
                      className={adminClass.buttonGhost}
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  patch({ options: [...editor.options, { value: "", labelEn: "", labelId: "" }] })
                }
                className={`${adminClass.buttonSecondary} mt-2`}
              >
                Tambah opsi
              </button>
              {editorFieldError === "options" ? (
                <p className="mt-2 text-[12px] text-danger">{editorError}</p>
              ) : null}
            </div>
          ) : null}

          {editor.type === "file" ? (
            <label className="mt-3 block sm:max-w-[200px]">
              <span className={adminClass.label}>Maks jumlah file (1–10)</span>
              <input
                type="number"
                min={1}
                max={10}
                value={editor.maxFiles}
                onChange={(e) => patch({ maxFiles: e.target.value })}
                className={inputClass("maxFiles")}
              />
            </label>
          ) : null}

          <div className="mt-4 rounded-lg border border-[var(--admin-line)] p-3">
            <span className={adminClass.label}>Aturan tampil (opsional)</span>
            <p className="mt-1 text-[12px] text-[var(--admin-muted)]">
              Kosongkan agar selalu tampil. Isi <code className="rounded bg-[var(--admin-hover)] px-1">purpose</code>{" "}
              atau key field lain di cakupan yang sama, lalu nilai yang harus cocok.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={editor.showWhenField}
                onChange={(e) => patch({ showWhenField: e.target.value })}
                placeholder="Field, mis. purpose"
                className={inputClass("showWhen")}
              />
              <input
                type="text"
                value={editor.showWhenEquals}
                onChange={(e) => patch({ showWhenEquals: e.target.value })}
                placeholder="Nilai, mis. business_meeting"
                className={adminClass.input}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={adminClass.label}>Placeholder (EN)</span>
              <input
                type="text"
                value={editor.placeholderEn}
                onChange={(e) => patch({ placeholderEn: e.target.value })}
                className={adminClass.input + " mt-1"}
              />
            </label>
            <label className="block">
              <span className={adminClass.label}>Placeholder (ID)</span>
              <input
                type="text"
                value={editor.placeholderId}
                onChange={(e) => patch({ placeholderId: e.target.value })}
                className={adminClass.input + " mt-1"}
              />
            </label>
            <label className="block">
              <span className={adminClass.label}>Teks bantuan (EN)</span>
              <input
                type="text"
                value={editor.helpEn}
                onChange={(e) => patch({ helpEn: e.target.value })}
                className={adminClass.input + " mt-1"}
              />
            </label>
            <label className="block">
              <span className={adminClass.label}>Teks bantuan (ID)</span>
              <input
                type="text"
                value={editor.helpId}
                onChange={(e) => patch({ helpId: e.target.value })}
                className={adminClass.input + " mt-1"}
              />
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={adminClass.buttonPrimary}
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
            <button
              type="button"
              onClick={() => setEditor(null)}
              disabled={saving}
              className={adminClass.buttonSecondary}
            >
              Batal
            </button>
          </div>
        </div>
      ) : null}

      <div className={adminClass.panel}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={adminClass.tableHead}>Key</th>
              <th className={adminClass.tableHead}>Label</th>
              <th className={adminClass.tableHead}>Jenis</th>
              <th className={adminClass.tableHead}>Cakupan</th>
              <th className={adminClass.tableHead}>Wajib</th>
              <th className={adminClass.tableHead}>Aktif</th>
              <th className={adminClass.tableHead}>Urutan</th>
              <th className={adminClass.tableHead} />
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={8} className={`${adminClass.tableCell} text-center text-[var(--admin-muted)]`}>
                  Memuat data…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className={`${adminClass.tableCell} text-center text-[var(--admin-muted)]`}>
                  Belum ada field dinamis. Tambahkan lewat tombol di atas.
                </td>
              </tr>
            ) : (
              rows.map((field) => (
                <tr key={field.id} className={adminClass.tableRow}>
                  <td className={adminClass.tableCell}>
                    <code className="text-[12px]">{field.key}</code>
                  </td>
                  <td className={adminClass.tableCell}>
                    {field.labelEn}
                    {field.labelId ? (
                      <span className="block text-[12px] text-[var(--admin-muted)]">{field.labelId}</span>
                    ) : null}
                  </td>
                  <td className={adminClass.tableCell}>{TYPE_LABELS[field.type]}</td>
                  <td className={adminClass.tableCell}>{SCOPE_LABELS[field.scope]}</td>
                  <td className={adminClass.tableCell}>
                    <span className={`${adminClass.pill} ${field.required ? adminClass.pillOn : adminClass.pillOff}`}>
                      {field.required ? "Wajib" : "Opsional"}
                    </span>
                  </td>
                  <td className={adminClass.tableCell}>
                    <button
                      type="button"
                      onClick={() => void toggleActive(field)}
                      disabled={togglingId === field.id}
                      title="Klik untuk mengubah status aktif"
                      className={`${adminClass.pill} ${field.active ? adminClass.pillOn : adminClass.pillOff} cursor-pointer transition-colors hover:border-[var(--admin-ink)] disabled:opacity-50`}
                    >
                      {togglingId === field.id ? "…" : field.active ? "Aktif" : "Nonaktif"}
                    </button>
                  </td>
                  <td className={adminClass.tableCell}>{field.sortOrder}</td>
                  <td className={`${adminClass.tableCell} text-right`}>
                    <button
                      type="button"
                      onClick={() => openEdit(field)}
                      className={adminClass.buttonGhost}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(field)}
                      disabled={deletingId === field.id}
                      className={adminClass.buttonGhost}
                    >
                      {deletingId === field.id ? "Menghapus…" : "Hapus"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
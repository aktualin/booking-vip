// Client-side helper for uploading e-VOA documents to the server, which
// stores them in Cloudflare R2. The browser never sees the R2 credentials —
// it only POSTs the file to our own route (src/app/api/uploads/evoa-doc).

export type EvoaUploadResult =
  | { ok: true; key: string; url: string; fileName: string; mimeType: string; sizeBytes: number }
  | { ok: false; error: string };

/**
 * Upload one e-VOA document. `slot` selects the validation rules on the
 * server: a standard slot ("passport" | "photo" | "ticket" | "hotel"), an
 * active admin-defined file-field key, or "visa-pdf" (admin session only).
 * The returned mimeType/sizeBytes describe the stored bytes — the server may
 * recompress passport/photo images to fit the official portal's 200 KB cap.
 */
export async function uploadEvoaDoc(
  file: File,
  slot: string,
): Promise<EvoaUploadResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("slot", slot);

  try {
    const res = await fetch("/api/uploads/evoa-doc", {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as EvoaUploadResult;
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.ok ? "Upload gagal." : data.error };
    }
    return data;
  } catch {
    return { ok: false, error: "Tidak bisa mengunggah file. Coba lagi." };
  }
}
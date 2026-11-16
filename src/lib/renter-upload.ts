// Client-side helper for uploading renter documents (ID + signature) to the
// server, which stores them in Cloudflare R2. The browser never sees the R2
// credentials — it only POSTs the file to our own route.

export type RenterDocKind = "id" | "signature";

export type UploadResult =
  | { ok: true; url: string; key: string }
  | { ok: false; error: string };

/**
 * Upload one renter document. `kind` selects the validation rules on the
 * server: "id" accepts images + PDF, "signature" accepts a PNG.
 */
export async function uploadRenterDoc(
  file: File | Blob,
  kind: RenterDocKind,
): Promise<UploadResult> {
  const form = new FormData();
  const name =
    file instanceof File
      ? file.name
      : kind === "signature"
        ? "signature.png"
        : "document";
  form.append("file", file, name);
  form.append("kind", kind);

  try {
    const res = await fetch("/api/uploads/renter-doc", {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as UploadResult;
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.ok ? "Upload gagal." : data.error };
    }
    return data;
  } catch {
    return { ok: false, error: "Tidak bisa mengunggah file. Coba lagi." };
  }
}
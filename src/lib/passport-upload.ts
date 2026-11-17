// Client-side helper for uploading a traveler's passport photo to the
// server, which stores it in the PRIVATE R2 bucket. The browser never sees
// the R2 credentials — it only POSTs the file to our own route and gets the
// object KEY back (never a public URL: passports are sensitive documents).

export type PassportUploadResult =
  | { ok: true; key: string }
  | { ok: false; error: string };

/**
 * Upload one passport photo (JPG / PNG / WEBP / PDF, max 8 MB — the server
 * enforces both). The returned key is what the booking stores.
 */
export async function uploadPassportPhoto(
  file: File | Blob,
): Promise<PassportUploadResult> {
  const form = new FormData();
  const name = file instanceof File ? file.name : "passport";
  form.append("file", file, name);

  try {
    const res = await fetch("/api/uploads/passport", {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as PassportUploadResult;
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.ok ? "Upload failed." : data.error };
    }
    return data;
  } catch {
    return { ok: false, error: "Could not upload the file. Please try again." };
  }
}
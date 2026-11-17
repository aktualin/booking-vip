// Upload endpoint for traveler passport photos (image or PDF scan).
//
// The browser POSTs multipart FormData with `file` (see
// src/lib/passport-upload.ts); the server validates the payload and stores
// the bytes in the PRIVATE R2 bucket. Passports are sensitive documents:
// only the object KEY is returned and stored — never a public URL. Access
// goes through short-lived signed URLs (signedDocumentUrl) on the server.
//
// Contract: `{ ok: true, key }` on success, `{ ok: false, error }` otherwise.
// Error messages are English — the audience is foreign tourists.
//
// Runs on the default Node.js runtime (Buffer + @aws-sdk need it). The
// `runtime` segment config is intentionally omitted — it is unsupported
// under `cacheComponents` (next.config.ts), which always uses Node.js.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { putPrivateObject } from "@/lib/storage";

const MB = 1024 * 1024;
const MAX_BYTES = 8 * MB;

/** Allowed content types → the key extension we store. */
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Invalid upload format.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return badRequest("No file was provided.");
  }
  if (file.size === 0) {
    return badRequest("The file is empty.");
  }
  // Size guard before buffering the bytes into memory.
  if (file.size > MAX_BYTES) {
    return badRequest("The file exceeds the 8 MB limit.");
  }

  const ext = TYPES[file.type];
  if (!ext) {
    return badRequest("Unsupported format. Use JPG, PNG, WEBP, or PDF.");
  }

  // Never trust the client filename — keys are server-generated UUIDs.
  const key = `passports/${randomUUID()}.${ext}`;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      return badRequest("The file exceeds the 8 MB limit.");
    }
    await putPrivateObject(key, bytes, file.type);
  } catch (error) {
    console.error("[upload] could not store passport document", key, error);
    return NextResponse.json(
      { ok: false, error: "Could not save the file. Please try again." },
      { status: 500 },
    );
  }

  // Private document — the key only, never a URL.
  return NextResponse.json({ ok: true, key });
}
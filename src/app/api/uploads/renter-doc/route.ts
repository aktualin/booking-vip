// Upload endpoint for renter documents (ID image/PDF + signature PNG).
//
// The browser POSTs multipart FormData with `file` and `kind` (see
// src/lib/renter-upload.ts); the server validates the payload and stores the
// bytes in Cloudflare R2. R2 credentials never reach the client.
//
// Contract: `{ ok: true, url, key }` on success, `{ ok: false, error }`
// otherwise. `url` is always the authenticated proxy path `/media/<key>`
// (served by src/app/media/[...key]/route.ts) — renter documents are PII and
// must never get a public CDN URL, even when CLOUDFLARE_S3_ENDPOINT is a
// public domain.
//
// Runs on the default Node.js runtime (Buffer + @aws-sdk need it). The
// `runtime` segment config is intentionally omitted — it is unsupported
// under `cacheComponents` (next.config.ts), which always uses Node.js.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { proxyMediaUrl, putObject } from "@/lib/storage";

const MB = 1024 * 1024;

/** Per-kind validation rules: allowed content types → key extension, and
 * the maximum accepted size. */
const RULES = {
  id: {
    types: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "application/pdf": "pdf",
    } as Record<string, string>,
    maxBytes: 8 * MB,
    maxLabel: "8 MB",
    typeError: "Format file tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.",
  },
  signature: {
    types: { "image/png": "png" } as Record<string, string>,
    maxBytes: 2 * MB,
    maxLabel: "2 MB",
    typeError: "Tanda tangan harus berupa file PNG.",
  },
};

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Format unggahan tidak valid.");
  }

  const kind = form.get("kind");
  if (kind !== "id" && kind !== "signature") {
    return badRequest("Jenis dokumen tidak valid.");
  }
  const rule = RULES[kind];

  const file = form.get("file");
  if (!(file instanceof File)) {
    return badRequest("File tidak ditemukan.");
  }
  if (file.size === 0) {
    return badRequest("File kosong.");
  }
  // Size guard before buffering the bytes into memory.
  if (file.size > rule.maxBytes) {
    return badRequest(`Ukuran file melebihi batas ${rule.maxLabel}.`);
  }

  const ext = rule.types[file.type];
  if (!ext) {
    return badRequest(rule.typeError);
  }

  // Never trust the client filename — keys are server-generated UUIDs.
  const key =
    kind === "id"
      ? `renter-docs/${randomUUID()}.${ext}`
      : `signatures/${randomUUID()}.png`;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength > rule.maxBytes) {
      return badRequest(`Ukuran file melebihi batas ${rule.maxLabel}.`);
    }
    await putObject(key, bytes, file.type);
  } catch (error) {
    console.error("[upload] could not store renter document", key, error);
    return NextResponse.json(
      { ok: false, error: "Gagal menyimpan file." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, url: proxyMediaUrl(key), key });
}

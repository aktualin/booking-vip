// Upload endpoint for e-VOA order documents (passport page, photo, ticket,
// hotel, admin-defined file fields, and the issued e-VOA PDF).
//
// The browser POSTs multipart FormData with `file` and `slot` (see
// src/lib/evoa-upload.ts); the server validates the payload and stores the
// bytes in Cloudflare R2. R2 credentials never reach the client.
//
// Contract: `{ ok: true, key, url, fileName, mimeType, sizeBytes }` on
// success, `{ ok: false, error }` otherwise. `mimeType`/`sizeBytes` describe
// the STORED bytes — passport/photo images may be recompressed to JPEG.
// `url` is always the authenticated proxy path `/media/<key>` (served by
// src/app/media/[...key]/route.ts) — e-VOA documents are PII and must never
// get a public CDN URL, even when CLOUDFLARE_S3_ENDPOINT is a public domain.
//
// Auth: customer slots need the user session; "visa-pdf" is uploaded by ops
// after the visa is issued, so it needs the admin session instead.
//
// Runs on the default Node.js runtime (Buffer + sharp + @aws-sdk need it).
// The `runtime` segment config is intentionally omitted — it is unsupported
// under `cacheComponents` (next.config.ts), which always uses Node.js.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/prisma/db";
import { evoaDocSlot, type EvoaDocSlotDef } from "@/lib/evoa-shared";
import { proxyMediaUrl, putObject } from "@/lib/storage";
import { getAdminSession } from "@/lib/admin/session";
import { getUserSession } from "@/lib/user/session";

const MB = 1024 * 1024;

/** The official Imigrasi portal caps passport-page & photo images at 200 KB
 * (JPG/PNG only) — we compress to that budget before storing. */
const PORTAL_MAX_BYTES = 200 * 1024;

/** MIME types → the key extension we store. */
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const DOC_ACCEPT = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const DOC_TYPE_ERROR =
  "Format file tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.";

type SlotRule = { accept: string[]; maxBytes: number; typeError: string };

/** Issued e-VOA PDFs — admin upload, PDF only. */
const VISA_PDF_RULE: SlotRule = {
  accept: ["application/pdf"],
  maxBytes: 8 * MB,
  typeError: "File e-VOA harus berupa PDF.",
};

/** Admin-defined "file" fields accept the same formats as the standard
 * document slots. */
const DYNAMIC_FILE_RULE: SlotRule = {
  accept: DOC_ACCEPT,
  maxBytes: 8 * MB,
  typeError: DOC_TYPE_ERROR,
};

function ruleForSlotDef(def: EvoaDocSlotDef): SlotRule {
  return {
    accept: def.accept,
    maxBytes: def.maxBytes,
    typeError:
      def.slot === "photo"
        ? "Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP."
        : DOC_TYPE_ERROR,
  };
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function unauthorized(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 401 });
}

/** Keep only the basename of the client filename — never a path — strip
 * control characters and cap the length. */
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 31 && code !== 127; // drop ASCII control characters
    })
    .join("")
    .trim();
  return (clean || "dokumen").slice(0, 120);
}

/** Shrink a passport/photo image to the portal's ≤200 KB JPEG budget.
 * Tries descending JPEG qualities at max 2000px first; only steps the
 * dimensions down when quality alone cannot reach the target. Returns null
 * when even the smallest attempt stays over budget. */
async function compressForPortal(input: Buffer): Promise<Buffer | null> {
  for (const dimension of [2000, 1600, 1200]) {
    for (const quality of [85, 65, 45, 30]) {
      const out = await sharp(input)
        .rotate() // honour EXIF orientation before JPEG strips the metadata
        .resize({
          width: dimension,
          height: dimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .toBuffer();
      if (out.byteLength <= PORTAL_MAX_BYTES) return out;
    }
  }
  return null;
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Format unggahan tidak valid.");
  }

  const slot = form.get("slot");
  if (typeof slot !== "string" || slot.length === 0) {
    return badRequest("Slot dokumen tidak valid.");
  }

  // Issued e-VOA PDFs are uploaded by ops (admin session); every other slot
  // belongs to the signed-in customer.
  if (slot === "visa-pdf") {
    if (!(await getAdminSession())) {
      return unauthorized("Sesi admin tidak valid. Silakan masuk kembali.");
    }
  } else if (!(await getUserSession())) {
    return unauthorized("Sesi tidak valid. Silakan masuk kembali.");
  }

  // Resolve the slot's validation rules: standard slot, the issued-visa PDF,
  // or an active admin-defined "file" field whose key doubles as the slot.
  let rule: SlotRule | undefined;
  if (slot === "visa-pdf") {
    rule = VISA_PDF_RULE;
  } else {
    const def = evoaDocSlot(slot);
    if (def) {
      rule = ruleForSlotDef(def);
    } else {
      const fields = await db.orm.public.EvoaFormField.select("id")
        .where((f) => f.key.eq(slot))
        .where((f) => f.type.eq("file"))
        .where((f) => f.active.eq(true))
        .limit(1)
        .all();
      if (fields.length > 0) rule = DYNAMIC_FILE_RULE;
    }
  }
  if (!rule) {
    return badRequest("Slot dokumen tidak dikenal.");
  }
  const maxLabel = `${rule.maxBytes / MB} MB`;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return badRequest("File tidak ditemukan.");
  }
  if (file.size === 0) {
    return badRequest("File kosong.");
  }
  // Size guard before buffering the bytes into memory.
  if (file.size > rule.maxBytes) {
    return badRequest(`Ukuran file melebihi batas ${maxLabel}.`);
  }
  if (!rule.accept.includes(file.type)) {
    return badRequest(rule.typeError);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return badRequest("File tidak bisa dibaca.");
  }
  if (bytes.byteLength > rule.maxBytes) {
    return badRequest(`Ukuran file melebihi batas ${maxLabel}.`);
  }

  let mimeType = file.type;
  // Passport page & photo must fit the official portal's ≤200 KB JPG/PNG
  // rule. Small JPEG/PNG files pass through untouched; WEBP is always
  // converted (the portal only accepts JPG/PNG); PDFs are never recompressed.
  if (
    (slot === "passport" || slot === "photo") &&
    file.type.startsWith("image/")
  ) {
    const alreadyFits =
      (file.type === "image/jpeg" || file.type === "image/png") &&
      bytes.byteLength <= PORTAL_MAX_BYTES;
    if (!alreadyFits) {
      let compressed: Buffer | null;
      try {
        compressed = await compressForPortal(bytes);
      } catch (error) {
        console.error("[upload] could not read e-VOA image", slot, error);
        return badRequest("File gambar rusak atau tidak bisa dibaca.");
      }
      if (!compressed) {
        return badRequest(
          "Gambar terlalu besar untuk dikompresi ke bawah 200 KB. Coba foto yang lebih sederhana.",
        );
      }
      bytes = compressed;
      mimeType = "image/jpeg";
    }
  }

  // Never trust the client filename — keys are server-generated UUIDs.
  const ext = EXT[mimeType];
  const key = `evoa-docs/${randomUUID()}.${ext}`;

  try {
    await putObject(key, bytes, mimeType);
  } catch (error) {
    console.error("[upload] could not store e-VOA document", key, error);
    return NextResponse.json(
      { ok: false, error: "Gagal menyimpan file." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    key,
    url: proxyMediaUrl(key),
    fileName: sanitizeFileName(file.name),
    mimeType,
    sizeBytes: bytes.byteLength,
  });
}
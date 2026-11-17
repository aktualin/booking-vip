// Server-side helpers for Cloudflare R2 (S3-compatible object storage).
//
// Files live in the `vip-book` bucket; the database stores a stable public
// URL for every object (`CLOUDFLARE_S3_ENDPOINT` + key). Never store signed
// or expiring URLs — those belong to the `Media.url` column as plain strings.
//
// Environment:
//   CLOUDFLARE_S3_API       S3 API, e.g. https://<account>.r2.cloudflarestorage.com/vip-book
//                           — used for signed server-side ops (put/head/get).
//                           A trailing bucket path is tolerated and ignored
//                           (the bucket is supplied per command).
//   CLOUDFLARE_S3_ENDPOINT  public base of the bucket, e.g. a custom domain
//                           like https://cdn.example.com or an r2.dev
//                           subdomain — the prefix stored in the database.
//                           Must NOT be an r2.cloudflarestorage.com host.
//   CLOUDFLARE_ACCESS_KEY_ID / CLOUDFLARE_ACCESS_SECRET  S3 credentials
//   R2_BUCKET               bucket name (default "vip-book")

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const R2_BUCKET = process.env["R2_BUCKET"] ?? "vip-book";

/**
 * Bucket for sensitive documents (passport photos). Falls back to the main
 * bucket until a dedicated private bucket is configured — set
 * `PRIVATE_R2_BUCKET` to a bucket WITHOUT public access in production.
 * Only the object key is ever stored in the database; access goes through
 * short-lived signed URLs, never through `mediaUrl()`.
 */
export const PRIVATE_R2_BUCKET = process.env["PRIVATE_R2_BUCKET"] ?? R2_BUCKET;

/** True when the URL points at the S3 API host rather than a public domain. */
function isS3ApiHost(url: string): boolean {
  return url.includes("r2.cloudflarestorage.com");
}

/**
 * The public URL prefix stored in the database — the bucket's custom domain
 * (`CLOUDFLARE_S3_ENDPOINT`), or null while unset. An r2.cloudflarestorage.com
 * host is an S3 API, not a public domain: it is rejected so images fall back
 * to the `/media/<key>` proxy instead of getting unreachable URLs.
 */
export function publicBaseUrl(): string | null {
  const base = process.env["CLOUDFLARE_S3_ENDPOINT"];
  if (!base || isS3ApiHost(base)) return null;
  return base.replace(/\/+$/, "");
}

/** Stable public URL of an object key (placeholder `/media/<key>` until the
 * public base URL is configured). Only for public site images — never for
 * PII, which must stay behind the authenticated proxy (`proxyMediaUrl`). */
export function mediaUrl(key: string): string {
  const base = publicBaseUrl();
  return base ? `${base}/${key}` : `/media/${key}`;
}

/** Authenticated-proxy URL of an object key — always `/media/<key>`, even
 * when a public base URL is configured. Use this for private documents
 * (passport scans, e-VOA documents, renter identity): the proxy route
 * enforces the ownership check, a public CDN URL would bypass it. */
export function proxyMediaUrl(key: string): string {
  return `/media/${key}`;
}

let client: S3Client | null = null;

/**
 * Shared S3 client — R2 uses path-style addressing and the "auto" region.
 * The endpoint comes from `CLOUDFLARE_S3_API` (a trailing bucket path is
 * tolerated and ignored — the bucket is supplied per command); a
 * `CLOUDFLARE_S3_ENDPOINT` that is an r2.cloudflarestorage.com host works too.
 */
export function r2(): S3Client {
  if (client) return client;
  const endpoint = (() => {
    const api = process.env["CLOUDFLARE_S3_API"];
    if (api) return new URL(api).origin; // strip any /<bucket> suffix
    const custom = process.env["CLOUDFLARE_S3_ENDPOINT"];
    if (custom && isS3ApiHost(custom)) return custom;
    return null;
  })();
  if (!endpoint || !process.env["CLOUDFLARE_ACCESS_KEY_ID"] || !process.env["CLOUDFLARE_ACCESS_SECRET"]) {
    throw new Error(
      "Missing R2 configuration — set CLOUDFLARE_S3_API (S3 endpoint) and CLOUDFLARE_ACCESS_KEY_ID / CLOUDFLARE_ACCESS_SECRET."
    );
  }
  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: process.env["CLOUDFLARE_ACCESS_KEY_ID"],
      secretAccessKey: process.env["CLOUDFLARE_ACCESS_SECRET"],
    },
    forcePathStyle: true,
  });
  return client;
}

/** True when the object already exists in the bucket. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      ?.$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw err;
  }
}

/** Upload a file; `contentType` should be e.g. "image/jpeg". */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

/** Delete one object. */
export async function deleteObject(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

/** Read an object body with its stored content type. */
export async function getObjectMeta(
  key: string
): Promise<{ body: Buffer; contentType: string | null } | null> {
  try {
    const res = await r2().send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    return {
      body: Buffer.from(await res.Body!.transformToByteArray()),
      contentType: res.ContentType ?? null,
    };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      ?.$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw err;
  }
}

/** Read an object body (used by the admin preview and maintenance jobs). */
export async function getObject(key: string): Promise<Buffer> {
  return (await getObjectMeta(key))!.body;
}

/**
 * Upload a sensitive document (passport photo) to the private bucket.
 * Unlike `putObject` it sets no public cache headers, and the caller must
 * store only the KEY — never a public URL.
 */
export async function putPrivateObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: PRIVATE_R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/**
 * Short-lived signed GET URL for a private document — the admin preview.
 * Ephemeral by design: never persist it (the `Media.url` rule stands).
 */
export async function signedDocumentUrl(
  key: string,
  expiresIn = 300
): Promise<string> {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({ Bucket: PRIVATE_R2_BUCKET, Key: key }),
    { expiresIn }
  );
}

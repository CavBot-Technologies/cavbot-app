import "server-only";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
  UploadPartCommand,
  type UploadPartCommandInput,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

const R2_KEY_PREFIX = "cavcloud/"; // must match the Worker contract

type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
};

type StreamBody = NonNullable<PutObjectCommandInput["Body"]>;
type MultipartStreamBody = NonNullable<UploadPartCommandInput["Body"]>;

function inferBucketFromEndpoint(rawEndpoint: string): { endpoint: string; bucket: string } | null {
  try {
    const u = new URL(rawEndpoint);

    // Path-style: https://<account>.r2.cloudflarestorage.com/<bucket>
    const pathParts = u.pathname.split("/").filter(Boolean);
    if (pathParts.length === 1) {
      return { endpoint: u.origin, bucket: pathParts[0] };
    }

    // Virtual-hosted-style: https://<bucket>.<account>.r2.cloudflarestorage.com
    const hostParts = u.hostname.split(".");
    if (hostParts.length === 5 && hostParts.slice(-3).join(".") === "r2.cloudflarestorage.com") {
      const bucket = hostParts[0];
      const account = hostParts[1];
      return { endpoint: `${u.protocol}//${account}.r2.cloudflarestorage.com`, bucket };
    }

    return null;
  } catch {
    return null;
  }
}

function loadR2Config(): R2Config | null {
  let endpoint = String(process.env.CAVCLOUD_R2_ENDPOINT || "").trim();
  const accessKeyId = String(process.env.CAVCLOUD_R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.CAVCLOUD_R2_SECRET_ACCESS_KEY || "").trim();
  let bucket = String(process.env.CAVCLOUD_R2_BUCKET || "").trim();
  const region = String(process.env.CAVCLOUD_R2_REGION || "auto").trim() || "auto";

  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  if (!bucket) {
    const inferred = inferBucketFromEndpoint(endpoint);
    if (inferred) {
      endpoint = inferred.endpoint;
      bucket = inferred.bucket;
    }
  }

  if (!bucket) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket, region };
}

let cachedClient: { cfgKey: string; client: S3Client } | null = null;

function getS3Client(cfg: R2Config): S3Client {
  const cfgKey = `${cfg.endpoint}|${cfg.accessKeyId}|${cfg.bucket}|${cfg.region}`;
  if (cachedClient?.cfgKey === cfgKey) return cachedClient.client;

  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    // R2 works reliably with path-style addressing across endpoint variants.
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  cachedClient = { cfgKey, client };
  return client;
}

function requireR2Config(): R2Config {
  const cfg = loadR2Config();
  if (!cfg) throw new Error("CAVCLOUD_R2_NOT_CONFIGURED");
  return cfg;
}

function normalizeObjectKey(objectKey: string): string {
  const clean = String(objectKey || "").trim().replace(/^\/+/, "");
  if (!clean) throw new Error("OBJECT_KEY_REQUIRED");
  return clean;
}

function r2KeyForObjectKey(objectKey: string): string {
  return `${R2_KEY_PREFIX}${normalizeObjectKey(objectKey)}`;
}

export function cavcloudR2Configured(): boolean {
  return loadR2Config() !== null;
}

export function cavcloudR2PrefixObjectKey(objectKey: string): string {
  return r2KeyForObjectKey(objectKey);
}

function emptyWebStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (!body) return emptyWebStream();

  const b = body as {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    getReader?: () => unknown;
  };

  if (typeof b.transformToWebStream === "function") {
    return b.transformToWebStream();
  }

  if (typeof b.getReader === "function") {
    return body as ReadableStream<Uint8Array>;
  }

  if (body instanceof Readable) {
    return Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
  }

  if (body instanceof Uint8Array) {
    const chunk = body;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  if (typeof body === "string") {
    const chunk = new TextEncoder().encode(body);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  return emptyWebStream();
}

export async function putCavcloudObject(options: {
  objectKey: string;
  body: Buffer;
  contentType: string;
  contentLength?: number;
}): Promise<void> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(options.objectKey);
  const contentType = String(options.contentType || "").trim() || "application/octet-stream";
  const contentLength = Number.isFinite(options.contentLength) ? Number(options.contentLength) : undefined;

  const client = getS3Client(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: options.body,
      ContentType: contentType,
      ContentLength: contentLength,
    })
  );
}

export async function putCavcloudObjectStream(options: {
  objectKey: string;
  body: StreamBody;
  contentType: string;
  contentLength?: number;
}): Promise<void> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(options.objectKey);
  const contentType = String(options.contentType || "").trim() || "application/octet-stream";
  const contentLength = Number.isFinite(options.contentLength) ? Number(options.contentLength) : undefined;

  const client = getS3Client(cfg);
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: options.body,
      ContentType: contentType,
      ContentLength: contentLength,
    })
  );
}

export async function deleteCavcloudObject(objectKey: string): Promise<void> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(objectKey);
  const client = getS3Client(cfg);
  await client.send(
    new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    })
  );
}

export async function headCavcloudObject(objectKey: string): Promise<{ bytes: number; etag: string | null } | null> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(objectKey);
  const client = getS3Client(cfg);

  try {
    const out = await client.send(
      new HeadObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
      })
    );
    const bytes = Number(out.ContentLength || 0);
    const etag = typeof out.ETag === "string" ? out.ETag : null;
    return { bytes: Number.isFinite(bytes) ? bytes : 0, etag };
  } catch (err: unknown) {
    const code = String((err as { name?: unknown; Code?: unknown })?.name || (err as { Code?: unknown })?.Code || "");
    if (code === "NotFound" || code === "NoSuchKey") return null;
    throw err;
  }
}

export async function getCavcloudObjectStream(options: {
  objectKey: string;
  range?: string;
}): Promise<{
  status: number;
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
  contentLength: number | null;
  contentRange: string | null;
  etag: string | null;
  lastModified: string | null;
  acceptRanges: string | null;
  contentDisposition: string | null;
  cacheControl: string | null;
  contentEncoding: string | null;
  contentLanguage: string | null;
} | null> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(options.objectKey);
  const client = getS3Client(cfg);

  try {
    const out = await client.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Range: String(options.range || "").trim() || undefined,
      })
    );

    const contentLengthRaw = Number(out.ContentLength);
    return {
      status: out.ContentRange ? 206 : 200,
      body: toWebStream(out.Body),
      contentType: typeof out.ContentType === "string" ? out.ContentType : null,
      contentLength: Number.isFinite(contentLengthRaw) ? contentLengthRaw : null,
      contentRange: typeof out.ContentRange === "string" ? out.ContentRange : null,
      etag: typeof out.ETag === "string" ? out.ETag : null,
      lastModified: out.LastModified ? new Date(out.LastModified).toUTCString() : null,
      acceptRanges: typeof out.AcceptRanges === "string" ? out.AcceptRanges : null,
      contentDisposition: typeof out.ContentDisposition === "string" ? out.ContentDisposition : null,
      cacheControl: typeof out.CacheControl === "string" ? out.CacheControl : null,
      contentEncoding: typeof out.ContentEncoding === "string" ? out.ContentEncoding : null,
      contentLanguage: typeof out.ContentLanguage === "string" ? out.ContentLanguage : null,
    };
  } catch (err: unknown) {
    const code = String((err as { name?: unknown; Code?: unknown })?.name || (err as { Code?: unknown })?.Code || "");
    if (code === "NotFound" || code === "NoSuchKey") return null;
    throw err;
  }
}

export async function createCavcloudMultipartUpload(options: {
  objectKey: string;
  contentType: string;
}): Promise<{ uploadId: string }> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(options.objectKey);
  const contentType = String(options.contentType || "").trim() || "application/octet-stream";

  const client = getS3Client(cfg);
  const out = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: contentType,
    })
  );

  const uploadId = String(out.UploadId || "").trim();
  if (!uploadId) throw new Error("R2_MULTIPART_CREATE_FAILED");
  return { uploadId };
}

export async function uploadCavcloudMultipartPart(options: {
  objectKey: string;
  uploadId: string;
  partNumber: number;
  body: MultipartStreamBody;
  contentLength?: number;
}): Promise<{ etag: string }> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(options.objectKey);
  const uploadId = String(options.uploadId || "").trim();
  const partNumber = Number(options.partNumber);
  if (!uploadId) throw new Error("R2_MULTIPART_UPLOAD_ID_REQUIRED");
  if (!Number.isFinite(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new Error("R2_MULTIPART_PART_NUMBER_INVALID");
  }

  const client = getS3Client(cfg);
  const out = await client.send(
    new UploadPartCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: options.body,
      ContentLength: Number.isFinite(options.contentLength) ? Number(options.contentLength) : undefined,
    })
  );

  const etag = String(out.ETag || "").trim();
  if (!etag) throw new Error("R2_MULTIPART_PART_ETAG_MISSING");
  return { etag };
}

export async function completeCavcloudMultipartUpload(options: {
  objectKey: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}): Promise<void> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(options.objectKey);
  const uploadId = String(options.uploadId || "").trim();
  if (!uploadId) throw new Error("R2_MULTIPART_UPLOAD_ID_REQUIRED");

  const normalizedParts: CompletedPart[] = options.parts
    .map((p) => ({
      PartNumber: Number(p.partNumber),
      ETag: String(p.etag || "").trim(),
    }))
    .filter((p) => Number.isFinite(p.PartNumber || 0) && (p.PartNumber || 0) > 0 && p.ETag)
    .sort((a, b) => Number(a.PartNumber || 0) - Number(b.PartNumber || 0));

  if (!normalizedParts.length) throw new Error("R2_MULTIPART_PARTS_REQUIRED");

  const client = getS3Client(cfg);
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: normalizedParts,
      },
    })
  );
}

export async function abortCavcloudMultipartUpload(options: { objectKey: string; uploadId: string }): Promise<void> {
  const cfg = requireR2Config();
  const key = r2KeyForObjectKey(options.objectKey);
  const uploadId = String(options.uploadId || "").trim();
  if (!uploadId) return;

  const client = getS3Client(cfg);
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
    })
  );
}

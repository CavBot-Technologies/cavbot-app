import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

const R2_KEY_PREFIX = "hq/";

type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
};

function inferBucketFromEndpoint(rawEndpoint: string): { endpoint: string; bucket: string } | null {
  try {
    const url = new URL(rawEndpoint);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length === 1) {
      return { endpoint: url.origin, bucket: pathParts[0] };
    }

    const hostParts = url.hostname.split(".");
    if (hostParts.length === 5 && hostParts.slice(-3).join(".") === "r2.cloudflarestorage.com") {
      const bucket = hostParts[0];
      const account = hostParts[1];
      return { endpoint: `${url.protocol}//${account}.r2.cloudflarestorage.com`, bucket };
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

let cachedClient: { key: string; client: S3Client } | null = null;

function getClient(config: R2Config) {
  const key = `${config.endpoint}|${config.bucket}|${config.accessKeyId}|${config.region}`;
  if (cachedClient?.key === key) return cachedClient.client;

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  cachedClient = { key, client };
  return client;
}

function requireConfig() {
  const config = loadR2Config();
  if (!config) throw new Error("HQ_R2_NOT_CONFIGURED");
  return config;
}

function normalizeObjectKey(objectKey: string) {
  const normalized = String(objectKey || "").trim().replace(/^\/+/, "");
  if (!normalized) throw new Error("HQ_R2_OBJECT_KEY_REQUIRED");
  return `${R2_KEY_PREFIX}${normalized}`;
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function toWebStream(body: unknown) {
  if (!body) return emptyStream();
  const typed = body as {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    getReader?: () => unknown;
  };

  if (typeof typed.transformToWebStream === "function") {
    return typed.transformToWebStream();
  }

  if (typeof typed.getReader === "function") {
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

  return emptyStream();
}

export function adminR2Configured() {
  return loadR2Config() !== null;
}

export async function putAdminR2Object(args: {
  objectKey: string;
  body: Buffer;
  contentType?: string | null;
  contentLength?: number | null;
}) {
  const config = requireConfig();
  const client = getClient(config);
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: normalizeObjectKey(args.objectKey),
    Body: args.body,
    ContentType: String(args.contentType || "").trim() || "application/octet-stream",
    ContentLength: Number.isFinite(args.contentLength) ? Number(args.contentLength) : undefined,
  }));
}

export async function getAdminR2Object(args: { objectKey: string; range?: string | null }) {
  const config = requireConfig();
  const client = getClient(config);

  try {
    const out = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: normalizeObjectKey(args.objectKey),
      Range: String(args.range || "").trim() || undefined,
    }));

    const contentLength = Number(out.ContentLength);
    return {
      status: out.ContentRange ? 206 : 200,
      body: toWebStream(out.Body),
      contentType: typeof out.ContentType === "string" ? out.ContentType : "application/octet-stream",
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      contentRange: typeof out.ContentRange === "string" ? out.ContentRange : null,
      etag: typeof out.ETag === "string" ? out.ETag : null,
      lastModified: out.LastModified ? new Date(out.LastModified).toUTCString() : null,
    };
  } catch (error) {
    const code = String((error as { name?: unknown; Code?: unknown })?.name || (error as { Code?: unknown })?.Code || "");
    if (code === "NoSuchKey" || code === "NotFound") return null;
    throw error;
  }
}

export async function deleteAdminR2Object(objectKey: string) {
  const config = requireConfig();
  const client = getClient(config);
  await client.send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: normalizeObjectKey(objectKey),
  }));
}

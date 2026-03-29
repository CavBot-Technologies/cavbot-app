import "server-only";

const DEFAULT_GATEWAY_ORIGIN = "https://cavcloud.cavbot.io";
const GATEWAY_PATH_PREFIX = "/cavcloud/";

export function cavcloudGatewayOrigin(): string {
  const v = String(process.env.CAVCLOUD_GATEWAY_ORIGIN || "").trim();
  if (!v) return DEFAULT_GATEWAY_ORIGIN;
  try {
    return new URL(v).origin;
  } catch {
    return DEFAULT_GATEWAY_ORIGIN;
  }
}

function encodeObjectKeyPath(objectKey: string): string {
  const clean = String(objectKey || "").trim().replace(/^\/+/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts.map((p) => encodeURIComponent(p)).join("/");
}

export function buildCavcloudGatewayUrl(options: {
  objectKey: string;
  token?: string;
  download?: boolean;
}): string {
  const origin = cavcloudGatewayOrigin();
  const path = `${GATEWAY_PATH_PREFIX}${encodeObjectKeyPath(options.objectKey)}`;
  const u = new URL(path, origin);
  if (options.token) u.searchParams.set("token", String(options.token));
  if (options.download) u.searchParams.set("download", "1");
  return u.toString();
}


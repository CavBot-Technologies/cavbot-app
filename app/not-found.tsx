import { headers } from "next/headers";
import NotFoundArcadeClient from "@/app/_components/NotFoundArcadeClient";
import { mintArcadeAssetToken } from "@/lib/arcade/tokens";
import { getAppOrigin } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATCH_CAVBOT_BASE_PATH = "/404/catch-cavbot/v1";
const LEGACY_PUBLIC_URL = "/";

function resolveRequestOrigin(): string {
  const h = headers();
  const fallback = new URL(getAppOrigin());
  const host = String(h.get("x-forwarded-host") || h.get("host") || fallback.host).trim();
  const proto = String(h.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "https";
  const lowerHost = host.toLowerCase();
  if (lowerHost.startsWith("localhost") || lowerHost.startsWith("127.0.0.1")) {
    return getAppOrigin();
  }
  return `${proto}://${host}`;
}

function buildSigned404GameUrl(): string {
  try {
    const token = mintArcadeAssetToken({
      origin: resolveRequestOrigin(),
      basePath: CATCH_CAVBOT_BASE_PATH,
      ttlSeconds: 240,
    });
    return `/api/embed/arcade/signed/${encodeURIComponent(token)}${CATCH_CAVBOT_BASE_PATH}/index.html`;
  } catch {
    return LEGACY_PUBLIC_URL;
  }
}

export default function NotFound() {
  return <NotFoundArcadeClient src={buildSigned404GameUrl()} />;
}

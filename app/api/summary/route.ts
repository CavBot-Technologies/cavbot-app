// app/api/summary/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { requireAccountContext, requireSession } from "@/lib/apiAuth";
import type { SummaryRange } from "@/lib/cavbotApi.server";
import { getTenantProjectSummary } from "@/lib/projectSummary.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function normalizeRange(input: string | null): SummaryRange {
  const v = String(input ?? "").trim();
  if (v === "24h" || v === "7d" || v === "14d" || v === "30d") return v as SummaryRange;
  return "30d";
}

function parseProjectId(raw: string | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeMaybeOrigin(input: string | null): string | undefined {
  const raw = String(input ?? "").trim();
  if (!raw) return undefined;

  const withProto =
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error("BAD_ORIGIN");
  }

  if (!u.hostname || u.hostname.includes("..")) throw new Error("BAD_ORIGIN");
  if (u.username || u.password) throw new Error("BAD_ORIGIN");

  return u.origin;
}

function asHttpError(e: unknown) {
  const msg = String((e as { message?: unknown })?.message || e);

  if (msg === "ACCOUNT_CONTEXT_REQUIRED") {
    return { status: 401, payload: { ok: false, error: "UNAUTHENTICATED" } };
  }
  if (msg === "UNAUTHORIZED" || msg === "NO_SESSION" || msg === "UNAUTHENTICATED") {
    return { status: 401, payload: { ok: false, error: "UNAUTHENTICATED" } };
  }
  if (msg === "FORBIDDEN") return { status: 403, payload: { ok: false, error: "FORBIDDEN" } };
  if (msg === "BAD_ORIGIN") return { status: 400, payload: { ok: false, error: "BAD_ORIGIN" } };
  if (msg === "PROJECT_NOT_FOUND") return { status: 404, payload: { ok: false, error: "PROJECT_NOT_FOUND" } };
  if (msg === "PROJECT_KEY_MISSING") return { status: 409, payload: { ok: false, error: "PROJECT_KEY_MISSING" } };

  return { status: 500, payload: { ok: false, error: "SUMMARY_PROXY_FAILED" } };
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const { searchParams } = new URL(req.url);

    const pid = parseProjectId(searchParams.get("projectId"));
    const projectSlug = String(searchParams.get("projectSlug") ?? "").trim();

    const range = normalizeRange(searchParams.get("range"));

    const siteOrigin = normalizeMaybeOrigin(
      searchParams.get("origin") ?? searchParams.get("siteOrigin")
    );
    const siteId = String(searchParams.get("siteId") ?? "").trim() || undefined;

    const { project, summary: data } = await getTenantProjectSummary({
      accountId: session.accountId,
      projectId: pid,
      projectSlug,
      range,
      siteOrigin,
      siteId,
    });

    return json({ ok: true, project, data }, 200);
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}

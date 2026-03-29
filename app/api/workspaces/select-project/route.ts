// app/api/workspaces/select-project/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "METHOD_NOT_ALLOWED";

function requestIdFrom(req: NextRequest) {
  const incoming =
    req.headers.get("x-request-id") ||
    req.headers.get("x-vercel-id") ||
    req.headers.get("cf-ray");
  return (incoming && incoming.trim()) || crypto.randomUUID();
}

function withBaseHeaders(headers?: HeadersInit, rid?: string) {
  const base: Record<string, string> = { ...NO_STORE_HEADERS };
  if (rid) base["x-cavbot-request-id"] = rid;
  return { ...(headers || {}), ...base };
}

function json(data: unknown, init?: number | ResponseInit, rid?: string) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: withBaseHeaders(resInit.headers, rid),
  });
}

function mapError(e: unknown): { status: number; payload: Record<string, unknown> } {
  if (isApiAuthError(e)) {
    const status = e.status || 401;
    const code = e.code || "UNAUTHORIZED";
    return { status, payload: { error: code } };
  }
  return { status: 500, payload: { error: "SERVER_ERROR" as ApiErrorCode } };
}

function parseProjectId(v: unknown): number | null {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

export async function POST(req: NextRequest) {
  const rid = requestIdFrom(req);

  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ error: "BAD_REQUEST" as ApiErrorCode, requestId: rid }, 400, rid);
    }

    const body = await readSanitizedJson(req, null as null | Record<string, unknown>);
    const pid = parseProjectId(body?.projectId);

    if (!pid) {
      return json({ error: "BAD_REQUEST" as ApiErrorCode, requestId: rid }, 400, rid);
    }

    // VERIFY: project must belong to this session's account
    const project = await prisma.project.findFirst({
      where: { id: pid, accountId: sess.accountId },
      select: { id: true },
    });

    if (!project) {
      return json({ error: "NOT_FOUND" as ApiErrorCode, requestId: rid }, 404, rid);
    }

    const res = json({ ok: true, projectId: pid, requestId: rid }, 200, rid);

    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    };

    // What readWorkspace() expects
    res.cookies.set("cb_active_project_id", String(pid), cookieOpts);

    // Keep legacy pointer too (some parts of app use it)
    res.cookies.set("cb_pid", String(pid), cookieOpts);

    return res;
  } catch (e) {
    const { status, payload } = mapError(e);
    return json({ ...payload, requestId: rid }, status, rid);
  }
}

export async function OPTIONS(req: NextRequest) {
  const rid = requestIdFrom(req);
  return new NextResponse(null, {
    status: 204,
    headers: withBaseHeaders({ Allow: "POST, OPTIONS" }, rid),
  });
}

export async function GET(req: NextRequest) {
  const rid = requestIdFrom(req);
  return json({ error: "METHOD_NOT_ALLOWED" as ApiErrorCode, requestId: rid }, 405, rid);
}

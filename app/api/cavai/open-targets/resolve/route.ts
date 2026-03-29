import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

type TargetKind = "cavcloudFileId" | "cavcloudPath";

type ResolveRequestBody = {
  target?: {
    kind?: unknown;
    type?: unknown;
    value?: unknown;
    target?: unknown;
    folderId?: unknown;
    workspaceId?: unknown;
    sha256?: unknown;
  };
  context?: {
    generatedAt?: unknown;
    folderId?: unknown;
    workspaceId?: unknown;
  };
};

type FileCandidate = {
  fileId: string;
  path: string;
  name: string;
  updatedAtISO: string;
  sha256?: string | null;
  workspaceId?: string | null;
  folderId?: string | null;
};

type CavCloudFileRow = {
  id: string;
  path: string;
  name: string;
  updatedAt: Date;
  sha256: string | null;
  workspaceId: string | null;
  folderId: string;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKind(input: unknown): TargetKind | null {
  const raw = String(input || "").trim();
  if (raw === "cavcloudFileId") return "cavcloudFileId";
  if (raw === "cavcloudPath") return "cavcloudPath";
  return null;
}

function normalizePath(input: string): string {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed.replace(/\/+/g, "/");
}

function parseTimestamp(input: unknown): number | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function toCandidate(row: CavCloudFileRow): FileCandidate {
  return {
    fileId: row.id,
    path: row.path,
    name: row.name,
    updatedAtISO: row.updatedAt.toISOString(),
    sha256: row.sha256,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
  };
}

function sortCandidatesStable(rows: CavCloudFileRow[]): CavCloudFileRow[] {
  return rows.slice().sort((a, b) => {
    const aPath = a.path.toLowerCase();
    const bPath = b.path.toLowerCase();
    if (aPath < bPath) return -1;
    if (aPath > bPath) return 1;
    const ts = b.updatedAt.getTime() - a.updatedAt.getTime();
    if (ts !== 0) return ts;
    return a.id.localeCompare(b.id);
  });
}

function pickDeterministicCandidate(args: {
  matches: CavCloudFileRow[];
  sha256?: string;
  generatedAtMs?: number | null;
}):
  | {
      status: "resolved";
      file: CavCloudFileRow;
    }
  | {
      status: "ambiguous";
      matches: CavCloudFileRow[];
    } {
  if (args.matches.length === 1) {
    return { status: "resolved", file: args.matches[0] };
  }

  let pool = sortCandidatesStable(args.matches);
  const preferredSha = readString(args.sha256).toLowerCase();

  if (preferredSha) {
    const shaHits = pool.filter((row) => String(row.sha256 || "").toLowerCase() === preferredSha);
    if (shaHits.length === 1) return { status: "resolved", file: shaHits[0] };
    if (shaHits.length > 1) pool = sortCandidatesStable(shaHits);
  }

  const generatedAtMs = Number.isFinite(Number(args.generatedAtMs)) ? Number(args.generatedAtMs) : null;
  if (generatedAtMs != null) {
    let bestDelta = Number.POSITIVE_INFINITY;
    let best: CavCloudFileRow[] = [];
    for (const row of pool) {
      const delta = Math.abs(new Date(row.updatedAt).getTime() - generatedAtMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = [row];
      } else if (delta === bestDelta) {
        best.push(row);
      }
    }
    if (best.length === 1) return { status: "resolved", file: best[0] };
    pool = sortCandidatesStable(best);
  }

  return { status: "ambiguous", matches: pool };
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const body = (await readSanitizedJson(req, null)) as ResolveRequestBody | null;
    if (!body || !body.target || typeof body.target !== "object") {
      return json({
        ok: false,
        requestId,
        error: "BAD_REQUEST",
        message: "target is required.",
      }, 400);
    }

    const kind = normalizeKind(body.target.kind) || normalizeKind(body.target.type);
    const value = readString(body.target.value) || readString(body.target.target);
    if (!kind || !value) {
      return json({
        ok: false,
        requestId,
        error: "INVALID_TARGET",
        message: "target kind and value are required.",
      }, 400);
    }

    const accountId = String(session.accountId || "").trim();
    const scopeFolderId = readString(body.target.folderId) || readString(body.context?.folderId) || "";
    const scopeWorkspaceId = readString(body.target.workspaceId) || readString(body.context?.workspaceId) || "";
    const preferredSha = readString(body.target.sha256);
    const generatedAtMs = parseTimestamp(body.context?.generatedAt);

    if (kind === "cavcloudFileId") {
      const file = await prisma.cavCloudFile.findFirst({
        where: {
          accountId,
          id: value,
          deletedAt: null,
          status: "READY",
          ...(scopeWorkspaceId ? { workspaceId: scopeWorkspaceId } : {}),
        },
        select: {
          id: true,
          path: true,
          name: true,
          updatedAt: true,
          sha256: true,
          workspaceId: true,
          folderId: true,
        },
      });

      if (!file) return json({ ok: true, requestId, status: "not_found" }, 200);
      return json({ ok: true, requestId, status: "resolved", file: toCandidate(file) }, 200);
    }

    const normalizedPath = normalizePath(value);
    const looksLikePath = value.includes("/");

    if (looksLikePath) {
      const file = await prisma.cavCloudFile.findFirst({
        where: {
          accountId,
          path: normalizedPath,
          deletedAt: null,
          status: "READY",
          ...(scopeWorkspaceId ? { workspaceId: scopeWorkspaceId } : {}),
        },
        select: {
          id: true,
          path: true,
          name: true,
          updatedAt: true,
          sha256: true,
          workspaceId: true,
          folderId: true,
        },
      });

      if (file) return json({ ok: true, requestId, status: "resolved", file: toCandidate(file) }, 200);
    }

    const fileName = looksLikePath
      ? value.split("/").filter(Boolean).pop() || ""
      : value;
    if (!fileName) return json({ ok: true, requestId, status: "not_found" }, 200);

    if (scopeFolderId) {
      const scoped = await prisma.cavCloudFile.findMany({
        where: {
          accountId,
          folderId: scopeFolderId,
          name: fileName,
          deletedAt: null,
          status: "READY",
          ...(scopeWorkspaceId ? { workspaceId: scopeWorkspaceId } : {}),
        },
        select: {
          id: true,
          path: true,
          name: true,
          updatedAt: true,
          sha256: true,
          workspaceId: true,
          folderId: true,
        },
      });

      if (scoped.length === 1) {
        return json({ ok: true, requestId, status: "resolved", file: toCandidate(scoped[0]) }, 200);
      }
      if (scoped.length > 1) {
        const picked = pickDeterministicCandidate({
          matches: scoped,
          sha256: preferredSha,
          generatedAtMs,
        });
        if (picked.status === "resolved") {
          return json({ ok: true, requestId, status: "resolved", file: toCandidate(picked.file) }, 200);
        }
        return json({ ok: true, requestId, status: "ambiguous", matches: picked.matches.map(toCandidate) }, 200);
      }
    }

    const whereBase = {
      accountId,
      name: fileName,
      deletedAt: null as Date | null,
      status: "READY" as const,
    };

    const workspaceMatches = scopeWorkspaceId
      ? await prisma.cavCloudFile.findMany({
          where: {
            ...whereBase,
            workspaceId: scopeWorkspaceId,
          },
          select: {
            id: true,
            path: true,
            name: true,
            updatedAt: true,
            sha256: true,
            workspaceId: true,
            folderId: true,
          },
        })
      : [];

    const accountMatches =
      workspaceMatches.length > 0
        ? workspaceMatches
        : await prisma.cavCloudFile.findMany({
            where: whereBase,
            select: {
              id: true,
              path: true,
              name: true,
              updatedAt: true,
              sha256: true,
              workspaceId: true,
              folderId: true,
            },
          });

    if (!accountMatches.length) {
      return json({ ok: true, requestId, status: "not_found" }, 200);
    }

    const picked = pickDeterministicCandidate({
      matches: accountMatches,
      sha256: preferredSha,
      generatedAtMs,
    });
    if (picked.status === "resolved") {
      return json({ ok: true, requestId, status: "resolved", file: toCandidate(picked.file) }, 200);
    }
    return json({ ok: true, requestId, status: "ambiguous", matches: picked.matches.map(toCandidate) }, 200);
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Server error";
    return json(
      {
        ok: false,
        requestId,
        error: "SERVER_ERROR",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}

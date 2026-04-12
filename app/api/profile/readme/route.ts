// app/api/profile/readme/route.ts
import { NextResponse } from "next/server";
import { revalidatePath, unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/apiAuth";
import {
  isAllowedReservedPublicUsername,
  isBasicUsername,
  isReservedUsername,
  normalizeUsername,
  RESERVED_ROUTE_SLUGS,
} from "@/lib/username";
import { readPublicProfileSettingsFallback } from "@/lib/publicProfile/publicProfileSettingsStore.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawDb = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...params: unknown[]) => Promise<T>;
};

const MAX_BYTES = 64 * 1024;
const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");
const ALLOW_RUNTIME_STORAGE_BOOTSTRAP = process.env.NODE_ENV !== "production";
const STORAGE_READY_CACHE_TTL_MS = ALLOW_RUNTIME_STORAGE_BOOTSTRAP ? 2_000 : 60_000;
const STORAGE_UNAVAILABLE_MESSAGE = "Profile README storage is temporarily unavailable.";
const STORAGE_UNAVAILABLE_RETRY_AFTER_MS = 15_000;

let _tableReady: boolean | null = null;
let _tableReadyCheckedAt = 0;

function json<T>(body: T, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      ...(init?.headers || {}),
    },
  });
}

function isUnsafeSlug(raw: string) {
  const v = String(raw || "").trim();
  if (!v) return true;
  if (v.includes(".") || v.includes("/") || v.includes("\\")) return true;
  return false;
}

function utf8Bytes(s: string) {
  return Buffer.byteLength(String(s ?? ""), "utf8");
}

function toSafeRevision(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function stripRawHtmlOutsideCodeFences(markdown: string) {
  const src = String(markdown ?? "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  let inFence = false;
  const out: string[] = [];

  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    // Remove HTML comments + tags outside fences.
    const cleaned = line
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[a-z][^>]*>/gi, "");
    out.push(cleaned);
  }

  return out.join("\n");
}

async function ensureTable(db: RawDb) {
  if (!ALLOW_RUNTIME_STORAGE_BOOTSTRAP) return;
  if (_tableReady) return;
  const createSql = `
CREATE TABLE IF NOT EXISTS "PublicProfileReadme" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "markdown" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
  const revisionSql = `
ALTER TABLE "PublicProfileReadme"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;
`;
  try {
    await db.$executeRawUnsafe(createSql);
    await db.$executeRawUnsafe(revisionSql);
    _tableReady = true;
    _tableReadyCheckedAt = Date.now();
  } catch {
    _tableReady = false;
    _tableReadyCheckedAt = Date.now();
  }
}

async function probeStorageReady(db: RawDb) {
  if (_tableReady !== null && Date.now() - _tableReadyCheckedAt < STORAGE_READY_CACHE_TTL_MS) {
    return _tableReady;
  }

  try {
    await db.$queryRaw`
      SELECT "revision"
      FROM "PublicProfileReadme"
      WHERE 1 = 0
    `;
    _tableReady = true;
  } catch {
    _tableReady = false;
  }
  _tableReadyCheckedAt = Date.now();
  return _tableReady;
}

async function ensureStorageReady(db: RawDb) {
  if (await probeStorageReady(db)) return true;
  if (!ALLOW_RUNTIME_STORAGE_BOOTSTRAP) return false;
  await ensureTable(db);
  return probeStorageReady(db);
}

function storageUnavailableResponse() {
  return json(
    {
      ok: false,
      kind: "retryable",
      error: "README_STORAGE_UNAVAILABLE",
      message: STORAGE_UNAVAILABLE_MESSAGE,
      retryAfterMs: STORAGE_UNAVAILABLE_RETRY_AFTER_MS,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(Math.ceil(STORAGE_UNAVAILABLE_RETRY_AFTER_MS / 1_000)),
      },
    },
  );
}

async function readRow(userId: string) {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ markdown: string | null; updatedAt: Date | null; revision: number | null }>>`
      SELECT "markdown", "updatedAt", "revision"
      FROM "PublicProfileReadme"
      WHERE "userId" = ${uid}
      LIMIT 1
    `;
    const r = rows?.[0];
    if (!r) return null;
    const markdownRaw = String(r.markdown ?? "");
    const markdown = markdownRaw.trim() ? markdownRaw : null;
    return {
      markdown,
      updatedAt: r.updatedAt ?? null,
      revision: toSafeRevision(r.revision, 0),
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = String(searchParams.get("username") || "").trim();
    if (isUnsafeSlug(raw)) return json({ ok: true, markdown: null, updatedAt: null, revision: 0 }, { status: 200 });

    const username = normalizeUsername(raw);
    if (!username) return json({ ok: true, markdown: null, updatedAt: null, revision: 0 }, { status: 200 });
    if (!isBasicUsername(username)) return json({ ok: true, markdown: null, updatedAt: null, revision: 0 }, { status: 200 });
    if ((RESERVED_ROUTE_SLUGS as readonly string[]).includes(username)) return json({ ok: true, markdown: null, updatedAt: null, revision: 0 }, { status: 200 });
    if (isReservedUsername(username) && !isAllowedReservedPublicUsername(username, OWNER_USERNAME)) {
      return json({ ok: true, markdown: null, updatedAt: null, revision: 0 }, { status: 200 });
    }

    const sess = await getSession(req).catch(() => null);
    const viewerUserId = sess && sess.systemRole === "user" ? String(sess.sub || "").trim() : "";

    // Determine visibility: owner can always read; otherwise require publicProfileEnabled.
    let userId = "";
    let isOwner = false;
    let isPublic = false;
    try {
      const row = await prisma.user.findUnique({
        where: { username },
        select: { id: true, publicProfileEnabled: true },
      });
      userId = String(row?.id || "");
      isOwner = Boolean(userId) && Boolean(viewerUserId) && userId === viewerUserId;
      isPublic = Boolean(row?.publicProfileEnabled);
    } catch {
      // If public profile columns aren't available (bootstrap), fall back to settings store.
      const basic = await prisma.user.findUnique({ where: { username }, select: { id: true } }).catch(() => null);
      userId = String(basic?.id || "");
      isOwner = Boolean(userId) && Boolean(viewerUserId) && userId === viewerUserId;
      if (userId) {
        const settings = await readPublicProfileSettingsFallback(prisma as unknown as RawDb, userId);
        isPublic = Boolean(settings.publicProfileEnabled);
      }
    }

    if (!userId) return json({ ok: true, markdown: null, updatedAt: null, revision: 0 }, { status: 200 });
    if (!isOwner && !isPublic) return json({ ok: true, markdown: null, updatedAt: null, revision: 0 }, { status: 200 });

    // Owner view should never be cached publicly.
    if (isOwner) noStore();

    const storageReady = await ensureStorageReady(prisma as unknown as RawDb);
    const row = storageReady ? await readRow(userId) : null;
    const updatedAtISO = row?.updatedAt ? new Date(row.updatedAt).toISOString() : null;
    const revision = toSafeRevision(row?.revision, 0);

    return json(
      { ok: true, markdown: row?.markdown ?? null, updatedAt: updatedAtISO, revision },
      {
        status: 200,
        headers: isOwner
          ? {
              "Cache-Control": "no-store, max-age=0",
              Pragma: "no-cache",
              Expires: "0",
              Vary: "Cookie",
            }
          : {
              "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=60",
              Vary: "Cookie",
            },
      }
    );
  } catch (e) {
    console.error("GET /api/profile/readme failed:", e);
    return json(
      { ok: true, degraded: true, markdown: null, updatedAt: null, revision: 0 },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PUT(req: Request) {
  noStore();
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json(
        { ok: false, error: "BAD_CSRF", message: "Missing request integrity token." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const sess = await getSession(req);
    if (!sess || sess.systemRole !== "user") {
      return json({ ok: false, message: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const userId = String(sess.sub || "").trim();
    if (!userId || userId === "system") {
      return json({ ok: false, message: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const body = (await readSanitizedJson(req, null)) as { markdown?: unknown; expectedRevision?: unknown } | null;
    const raw = body && typeof body === "object" ? (body.markdown as unknown) : undefined;
    if (typeof raw !== "string") {
      return json({ ok: false, message: "Invalid body" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    let expectedRevision: number | null = null;
    if (body && typeof body === "object" && body.expectedRevision != null) {
      const parsedExpected = Number(body.expectedRevision);
      if (!Number.isFinite(parsedExpected) || !Number.isInteger(parsedExpected) || parsedExpected < 0) {
        return json({ ok: false, message: "Invalid expectedRevision" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      expectedRevision = Math.trunc(parsedExpected);
    }

    const cleaned = stripRawHtmlOutsideCodeFences(raw);
    if (utf8Bytes(cleaned) > MAX_BYTES) {
      return json({ ok: false, message: "README too large (max 64KB)" }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }

    if (!(await ensureStorageReady(prisma as unknown as RawDb))) {
      return storageUnavailableResponse();
    }

    const normalizedMarkdown = cleaned.trim() ? cleaned : "";
    const saveResult = await prisma.$transaction(async (tx) => {
      const currentRows = await tx.$queryRaw<Array<{ revision: number | null }>>`
        SELECT "revision"
        FROM "PublicProfileReadme"
        WHERE "userId" = ${userId}
        LIMIT 1
      `;
      const current = currentRows?.[0] || null;
      const currentRevision = toSafeRevision(current?.revision, 0);

      if (!current) {
        if (expectedRevision != null && expectedRevision !== 0) {
          return {
            ok: false as const,
            currentRevision,
          };
        }
        const insertedRows = await tx.$queryRaw<Array<{ revision: number; updatedAt: Date | null }>>`
          INSERT INTO "PublicProfileReadme" ("userId", "markdown", "revision", "createdAt", "updatedAt")
          VALUES (${userId}, ${normalizedMarkdown}, 1, NOW(), NOW())
          ON CONFLICT ("userId") DO UPDATE SET
            "markdown" = EXCLUDED."markdown",
            "revision" = "PublicProfileReadme"."revision" + 1,
            "updatedAt" = NOW()
          RETURNING "revision", "updatedAt"
        `;
        const inserted = insertedRows?.[0];
        return {
          ok: true as const,
          revision: toSafeRevision(inserted?.revision, currentRevision + 1),
          updatedAtISO: inserted?.updatedAt ? new Date(inserted.updatedAt).toISOString() : null,
        };
      }

      if (expectedRevision != null) {
        const updatedRows = await tx.$queryRaw<Array<{ revision: number; updatedAt: Date | null }>>`
          UPDATE "PublicProfileReadme"
          SET "markdown" = ${normalizedMarkdown},
              "revision" = "revision" + 1,
              "updatedAt" = NOW()
          WHERE "userId" = ${userId}
            AND "revision" = ${expectedRevision}
          RETURNING "revision", "updatedAt"
        `;
        const updated = updatedRows?.[0];
        if (!updated) {
          return {
            ok: false as const,
            currentRevision,
          };
        }
        return {
          ok: true as const,
          revision: toSafeRevision(updated.revision, currentRevision + 1),
          updatedAtISO: updated.updatedAt ? new Date(updated.updatedAt).toISOString() : null,
        };
      }

      const updatedRows = await tx.$queryRaw<Array<{ revision: number; updatedAt: Date | null }>>`
        UPDATE "PublicProfileReadme"
        SET "markdown" = ${normalizedMarkdown},
            "revision" = "revision" + 1,
            "updatedAt" = NOW()
        WHERE "userId" = ${userId}
        RETURNING "revision", "updatedAt"
      `;
      const updated = updatedRows?.[0];
      return {
        ok: true as const,
        revision: toSafeRevision(updated?.revision, currentRevision + 1),
        updatedAtISO: updated?.updatedAt ? new Date(updated.updatedAt).toISOString() : null,
      };
    });

    if (!saveResult.ok) {
      const latest = await readRow(userId);
      return json(
        {
          ok: false,
          error: "REVISION_CONFLICT",
          message: "README changed on another session. Reload and retry.",
          currentRevision: toSafeRevision(latest?.revision, saveResult.currentRevision),
          markdown: latest?.markdown ?? null,
          updatedAt: latest?.updatedAt ? new Date(latest.updatedAt).toISOString() : null,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    const u = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } }).catch(() => null);
    const username = String(u?.username || "").trim();
    if (username) {
      try { revalidatePath(`/u/${username}`); } catch {}
      try { revalidatePath(`/${username}`); } catch {}
    }

    return json(
      { ok: true, revision: saveResult.revision, updatedAt: saveResult.updatedAtISO },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("PUT /api/profile/readme failed:", e);
    return storageUnavailableResponse();
  }
}

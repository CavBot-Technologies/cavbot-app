import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_ACTIONS = new Set([
  "upload.files",
  "upload.folder",
  "upload.camera_roll",
  "upload.preview",
  "file.star",
  "file.unstar",
  "folder.star",
  "folder.unstar",
]);

type ActivityBody = {
  action?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  targetPath?: unknown;
  metaJson?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asPositiveInt(raw: string | null, fallback: number, max = 200): number {
  const n = Number(String(raw || "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, n));
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);
    const url = new URL(req.url);
    const limit = asPositiveInt(url.searchParams.get("limit"), 50, 300);

    const rows = await prisma.cavSafeActivity.findMany({
      where: { accountId: sess.accountId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        targetPath: true,
        metaJson: true,
        createdAt: true,
      },
    });

    return jsonNoStore(
      {
        ok: true,
        items: rows.map((row) => ({
          id: row.id,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          targetPath: row.targetPath,
          metaJson: row.metaJson,
          createdAtISO: new Date(row.createdAt).toISOString(),
        })),
      },
      200
    );
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load activity.");
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const body = (await readSanitizedJson(req, null)) as ActivityBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const action = String(body.action || "").trim().toLowerCase();
    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return jsonNoStore({ ok: false, error: "ACTION_INVALID", message: "Action is not allowed." }, 400);
    }

    const targetType = String(body.targetType || "upload").trim().slice(0, 32) || "upload";
    const targetId = String(body.targetId || "").trim().slice(0, 128) || null;
    const targetPath = String(body.targetPath || "").trim().slice(0, 800) || null;
    const metaJson = asObject(body.metaJson);

    await prisma.cavSafeActivity.create({
      data: {
        accountId: sess.accountId,
        operatorUserId: sess.sub,
        action,
        targetType,
        targetId,
        targetPath,
        metaJson: (metaJson || undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to record activity.");
  }
}

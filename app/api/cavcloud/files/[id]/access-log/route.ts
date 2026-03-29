import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import {
  CAVCLOUD_ACCESS_OPERATION_KINDS,
  asMetaObject,
  cavcloudAccessActionLabel,
} from "@/lib/cavcloud/historyLayers.server";
import {
  cavcloudOperationCursorWhere,
  decodeCavCloudOperationCursor,
  encodeCavCloudOperationCursor,
} from "@/lib/cavcloud/operationCursor.server";
import { getCavCloudOperatorContext, isRoleAllowedToViewAccessLogs, assertEffectivePermission } from "@/lib/cavcloud/permissions.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 25;
  return Math.max(1, Math.min(100, n));
}

function operatorDisplayName(operator: { displayName: string | null; username: string | null; email: string | null }): string {
  const displayName = String(operator.displayName || "").trim();
  if (displayName) return displayName;
  const username = String(operator.username || "").trim();
  if (username) return username;
  const email = String(operator.email || "").trim();
  if (email) return email;
  return "CavCloud user";
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const accountId = String(sess.accountId || "").trim();
    const userId = String(sess.sub || "").trim();
    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);

    await assertEffectivePermission({
      accountId,
      userId,
      resourceType: "FILE",
      resourceId: fileId,
      needed: "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    const operator = await getCavCloudOperatorContext({ accountId, userId });
    if (!isRoleAllowedToViewAccessLogs(operator.role, operator.policy)) {
      throw new ApiAuthError("UNAUTHORIZED", 403);
    }

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = decodeCavCloudOperationCursor(url.searchParams.get("cursor"));

    const rows = await prisma.cavCloudOperationLog.findMany({
      where: {
        accountId,
        kind: { in: CAVCLOUD_ACCESS_OPERATION_KINDS },
        subjectType: "file",
        subjectId: fileId,
        ...cavcloudOperationCursorWhere(cursor),
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
      select: {
        id: true,
        kind: true,
        subjectType: true,
        subjectId: true,
        label: true,
        meta: true,
        createdAt: true,
        operator: {
          select: {
            id: true,
            displayName: true,
            username: true,
            email: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCavCloudOperationCursor(pageRows[pageRows.length - 1]) : null;

    return jsonNoStore({
      ok: true,
      rows: pageRows.map((row) => {
        const meta = asMetaObject(row.meta);
        const operatorRow = row.operator || null;
        return {
          id: row.id,
          kind: row.kind,
          actionLabel: cavcloudAccessActionLabel(row.kind),
          createdAtISO: row.createdAt.toISOString(),
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          targetPath: String(meta?.path || row.label || "").trim() || null,
          meta: meta ?? null,
          operator: operatorRow
            ? {
                id: operatorRow.id,
                displayName: operatorDisplayName(operatorRow),
                username: operatorRow.username ? String(operatorRow.username) : null,
                initials: operatorDisplayName(operatorRow)
                  .split(/\s+/g)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => String(part[0] || "").toUpperCase())
                  .join("") || "CB",
              }
            : {
                id: null,
                displayName: "System",
                username: null,
                initials: "SY",
              },
        };
      }),
      nextCursor,
    }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load file access log.");
  }
}


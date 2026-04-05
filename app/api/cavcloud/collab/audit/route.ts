import { requireAccountContext, requireAccountRole, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import {
  asMetaObject,
  cavcloudAccessActionLabel,
  cavcloudAccessKindsForFilter,
  type CavCloudAccessAuditFilter,
} from "@/lib/cavcloud/historyLayers.server";
import {
  cavcloudOperationCursorWhere,
  decodeCavCloudOperationCursor,
  encodeCavCloudOperationCursor,
} from "@/lib/cavcloud/operationCursor.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 40;
  return Math.max(1, Math.min(150, n));
}

function parseFilter(raw: string | null): CavCloudAccessAuditFilter {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "grants") return "grants";
  if (value === "open_downloads") return "open_downloads";
  if (value === "edits") return "edits";
  return "all";
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

function isCavCloudAuditSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["CavCloudOperationLog", "User", "Membership"],
    columns: [
      "accountId",
      "kind",
      "subjectType",
      "subjectId",
      "label",
      "meta",
      "createdAt",
      "operatorId",
      "displayName",
      "username",
      "email",
      "role",
    ],
  });
}

async function buildDegradedAuditResponse(req: Request, filter: CavCloudAccessAuditFilter) {
  const sess = await requireSession(req);
  requireUser(sess);
  requireAccountContext(sess);
  requireAccountRole(sess, ["OWNER"]);

  return jsonNoStore(
    {
      ok: true,
      degraded: true,
      rows: [],
      nextCursor: null,
      filter,
    },
    200,
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get("kind"));
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);
    requireAccountRole(sess, ["OWNER"]);

    const accountId = String(sess.accountId || "").trim();
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = decodeCavCloudOperationCursor(url.searchParams.get("cursor"));
    const kinds = cavcloudAccessKindsForFilter(filter);

    const rows = await prisma.cavCloudOperationLog.findMany({
      where: {
        accountId,
        kind: { in: kinds },
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
        const targetPath = String(meta?.path || meta?.targetPath || meta?.toPath || row.label || "").trim() || null;
        const fileId = String(
          meta?.fileId
          || (String(row.subjectType || "").toLowerCase() === "file" ? row.subjectId : "")
          || "",
        ).trim() || null;
        const folderId = String(
          meta?.folderId
          || (String(row.subjectType || "").toLowerCase() === "folder" ? row.subjectId : "")
          || "",
        ).trim() || null;
        const operatorRow = row.operator || null;

        const display = operatorRow ? operatorDisplayName(operatorRow) : "System";
        return {
          id: row.id,
          kind: row.kind,
          actionLabel: cavcloudAccessActionLabel(row.kind),
          createdAtISO: row.createdAt.toISOString(),
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          targetPath,
          targetFileId: fileId,
          targetFolderId: folderId,
          targetLabel: targetPath || row.subjectId,
          deepLinkHref: fileId ? `/cavcloud/view/${encodeURIComponent(fileId)}?source=file` : null,
          meta: meta ?? null,
          operator: {
            id: operatorRow?.id || null,
            displayName: display,
            username: operatorRow?.username ? String(operatorRow.username) : null,
            initials: display
              .split(/\s+/g)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => String(part[0] || "").toUpperCase())
              .join("") || "SY",
          },
        };
      }),
      nextCursor,
      filter,
    }, 200);
  } catch (err) {
    if (isCavCloudAuditSchemaMismatch(err)) {
      try {
        return await buildDegradedAuditResponse(req, filter);
      } catch (fallbackError) {
        return cavcloudErrorResponse(fallbackError, "Failed to load collaboration audit.");
      }
    }
    try {
      return await buildDegradedAuditResponse(req, filter);
    } catch {
      // Preserve the original error response if fallback auth/context resolution also fails.
    }
    return cavcloudErrorResponse(err, "Failed to load collaboration audit.");
  }
}

import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudStorageThresholds, notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudPlanContext } from "@/lib/cavcloud/plan.server";
import { upsertTextFile } from "@/lib/cavcloud/storage.server";
import { upsertTextFile as upsertCavsafeTextFile } from "@/lib/cavsafe/storage.server";
import { assertCavCloudActionAllowed, getCavCloudOperatorContext } from "@/lib/cavcloud/permissions.server";
import { assertCavPadSyncTargetEnabled } from "@/lib/cavpad/server";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UpsertSyncBody = {
  folderPath?: unknown;
  name?: unknown;
  mimeType?: unknown;
  content?: unknown;
  source?: unknown;
};

function normalizePathNoTrailingSlash(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function joinPath(folderPath: string, fileName: string): string {
  const folder = normalizePathNoTrailingSlash(folderPath);
  const name = String(fileName || "").trim();
  if (!name) return folder;
  return folder === "/" ? `/${name}` : `${folder}/${name}`;
}

function isCavPadFolderPath(folderPath: string): boolean {
  const normalized = normalizePathNoTrailingSlash(folderPath);
  return normalized === "/Synced/CavPad" || normalized.startsWith("/Synced/CavPad/");
}

export async function POST(req: Request) {
  let accountId = "";
  let userId = "";
  let nameForError = "";
  let mirrorWarning: string | null = null;
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();

    const body = (await readSanitizedJson(req, null)) as UpsertSyncBody | null;
    if (!body) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const folderPath = String(body.folderPath || "/").trim() || "/";
    const name = String(body.name || "").trim();
    nameForError = name;
    const mimeType = body.mimeType == null ? null : String(body.mimeType || "").trim() || null;
    const content = String(body.content || "");
    const source = body.source == null ? null : String(body.source || "").trim() || null;
    const sourceLc = String(source || "").toLowerCase();
    const isCavpadSource = sourceLc.includes("cavpad");
    const normalizedFolderPath = normalizePathNoTrailingSlash(folderPath);
    const isCavpadSyncWrite = isCavpadSource || isCavPadFolderPath(normalizedFolderPath);
    if (isCavpadSyncWrite) {
      await assertCavPadSyncTargetEnabled({
        accountId: sess.accountId,
        userId: sess.sub,
        target: "cavcloud",
      });
    }
    const planId = (await getCavCloudPlanContext(String(sess.accountId || ""))).planId;
    const cavsafePlanEnabled = planId === "premium" || planId === "premium_plus";
    const normalizedFilePath = joinPath(normalizedFolderPath, name);
    const shouldMirrorToCavsafe = cavsafePlanEnabled
      && !isCavpadSyncWrite
      && (
        sourceLc.includes("cavcode")
        || normalizedFolderPath === "/Synced"
        || normalizedFolderPath.startsWith("/Synced/")
      );

    const existingFile = await prisma.cavCloudFile.findFirst({
      where: {
        accountId: sess.accountId,
        path: normalizedFilePath,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (existingFile?.id) {
      await assertCavCloudActionAllowed({
        accountId: sess.accountId,
        userId: sess.sub,
        action: "EDIT_FILE_CONTENT",
        resourceType: "FILE",
        resourceId: existingFile.id,
        neededPermission: "EDIT",
        errorCode: "UNAUTHORIZED",
      });
    } else {
      const folder = await prisma.cavCloudFolder.findFirst({
        where: {
          accountId: sess.accountId,
          path: normalizedFolderPath,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (folder?.id) {
        await assertCavCloudActionAllowed({
          accountId: sess.accountId,
          userId: sess.sub,
          action: "UPLOAD_FILE",
          resourceType: "FOLDER",
          resourceId: folder.id,
          neededPermission: "EDIT",
          errorCode: "UNAUTHORIZED",
        });
      } else {
        await assertCavCloudActionAllowed({
          accountId: sess.accountId,
          userId: sess.sub,
          action: "CREATE_FOLDER",
          errorCode: "UNAUTHORIZED",
        });
        await assertCavCloudActionAllowed({
          accountId: sess.accountId,
          userId: sess.sub,
          action: "UPLOAD_FILE",
          errorCode: "UNAUTHORIZED",
        });
      }
    }

    const file = await upsertTextFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderPath,
      name,
      mimeType,
      content,
      source,
    });

    const operator = await getCavCloudOperatorContext({
      accountId: sess.accountId,
      userId: sess.sub,
    });

    if (shouldMirrorToCavsafe && operator.role === "OWNER") {
      try {
        await upsertCavsafeTextFile({
          accountId: sess.accountId,
          operatorUserId: sess.sub,
          folderPath,
          name,
          mimeType,
          content,
          source,
        });
      } catch (mirrorErr) {
        mirrorWarning = `Mirroring to CavSafe failed (${(mirrorErr as Error)?.message || "unknown error"}).`;
      }
    } else if (shouldMirrorToCavsafe && operator.role !== "OWNER") {
      mirrorWarning = "CavSafe mirroring skipped because it is restricted to the account owner.";
    }

    if (accountId && userId) {
      try {
        await notifyCavCloudStorageThresholds({ accountId, userId });
      } catch {
        // Non-blocking notification write.
      }
    }

    return jsonNoStore({ ok: true, file, mirrorWarning }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          fileName: nameForError || null,
          context: "Sync upsert",
          errorMessage: (err as { message?: unknown })?.message ? String((err as { message?: unknown }).message) : null,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }
    return cavcloudErrorResponse(err, "Failed to sync file.");
  }
}

import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { runGoogleDriveImportSessionBatch } from "@/lib/integrations/googleDriveImport.server";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunBody = {
  maxItems?: unknown;
};

export async function POST(req: Request, ctx: { params: { sessionId?: string } }) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const sessionId = String(ctx?.params?.sessionId || "").trim();
    if (!sessionId) {
      return jsonNoStore({ ok: false, error: "SESSION_ID_REQUIRED", message: "sessionId is required." }, 400);
    }

    const owned = await prisma.cavCloudImportSession.findFirst({
      where: {
        id: sessionId,
        accountId: session.accountId,
        userId: session.sub,
        provider: "GOOGLE_DRIVE",
      },
      select: {
        targetFolderId: true,
      },
    });

    if (!owned?.targetFolderId) {
      return jsonNoStore({ ok: false, error: "NOT_FOUND", message: "Import session not found." }, 404);
    }

    await assertCavCloudActionAllowed({
      accountId: session.accountId,
      userId: session.sub,
      action: "UPLOAD_FILE",
      resourceType: "FOLDER",
      resourceId: owned.targetFolderId,
      neededPermission: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    const body = (await readSanitizedJson(req, null)) as RunBody | null;

    const result = await runGoogleDriveImportSessionBatch({
      accountId: session.accountId,
      userId: session.sub,
      sessionId,
      maxItems: body?.maxItems == null ? undefined : Number(body.maxItems),
    });

    return jsonNoStore({
      ok: true,
      ...result,
    }, 200);
  } catch (error) {
    return cavcloudErrorResponse(error, "Failed to run Google Drive import batch.");
  }
}

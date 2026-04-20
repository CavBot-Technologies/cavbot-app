import { requireAccountContext, requireLowRiskWriteSession, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavPadSettings, updateCavPadSettings } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_CAVPAD_SETTINGS = {
  syncToCavcloud: false,
  syncToCavsafe: false,
  allowSharing: true,
  defaultSharePermission: "VIEW" as const,
  defaultShareExpiryDays: 0 as const,
  noteExpiryDays: 0 as const,
  trashRetentionDays: 30 as const,
};

type PatchSettingsBody = {
  syncToCavcloud?: unknown;
  syncToCavsafe?: unknown;
  allowSharing?: unknown;
  defaultSharePermission?: unknown;
  defaultShareExpiryDays?: unknown;
  noteExpiryDays?: unknown;
};

function parsePermission(value: unknown): "VIEW" | "EDIT" {
  return String(value || "VIEW").trim().toUpperCase() === "EDIT" ? "EDIT" : "VIEW";
}

function parseDayValue(value: unknown): 0 | 7 | 30 {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const day = Math.trunc(n);
  return day === 7 || day === 30 ? day : 0;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "true" || raw === "1" || raw === "on" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return Boolean(value);
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    try {
      const settings = await getCavPadSettings({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      });

      return jsonNoStore({ ok: true, settings }, 200);
    } catch {
      return jsonNoStore({ ok: true, degraded: true, settings: DEFAULT_CAVPAD_SETTINGS }, 200);
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load CavPad settings.");
  }
}

export async function PATCH(req: Request) {
  try {
    const sess = await requireLowRiskWriteSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as PatchSettingsBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    try {
      const settings = await updateCavPadSettings({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
        syncToCavcloud: parseOptionalBoolean(body.syncToCavcloud),
        syncToCavsafe: parseOptionalBoolean(body.syncToCavsafe),
        allowSharing: parseOptionalBoolean(body.allowSharing),
        defaultSharePermission: body.defaultSharePermission == null ? undefined : parsePermission(body.defaultSharePermission),
        defaultShareExpiryDays: body.defaultShareExpiryDays == null ? undefined : parseDayValue(body.defaultShareExpiryDays),
        noteExpiryDays: body.noteExpiryDays == null ? undefined : parseDayValue(body.noteExpiryDays),
      });

      return jsonNoStore({ ok: true, settings }, 200);
    } catch {
      const settings = await getCavPadSettings({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      }).catch(() => DEFAULT_CAVPAD_SETTINGS);

      return jsonNoStore({ ok: true, degraded: true, settings }, 200);
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update CavPad settings.");
  }
}

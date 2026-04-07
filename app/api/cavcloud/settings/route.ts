import { requireAccountContext, requireAccountRole, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import {
  DEFAULT_CAVCLOUD_SETTINGS,
  getCavCloudSettings,
  parseCavCloudSettingsPatch,
  updateCavCloudSettings,
} from "@/lib/cavcloud/settings.server";
import {
  DEFAULT_CAVCLOUD_COLLAB_POLICY,
  getCavCloudCollabPolicy,
  parseCavCloudCollabPolicyPatch,
  updateCavCloudCollabPolicy,
} from "@/lib/cavcloud/collabPolicy.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function resolveGuardPlan(accountIdRaw: string): Promise<"FREE" | "PREMIUM" | "PREMIUM_PLUS"> {
  const accountId = String(accountIdRaw || "").trim();
  if (!accountId) return "FREE";
  const plan = await getEffectiveAccountPlanContext(accountId).catch(() => null);
  if (!plan) return "FREE";
  if (plan.planId === "premium_plus") return "PREMIUM_PLUS";
  if (plan.planId === "premium") return "PREMIUM";
  return "FREE";
}

async function buildOwnerSettingsGuard(args: {
  accountId: string;
  role?: string | null;
  actionId?: string;
}) {
  const guardPlan = await resolveGuardPlan(args.accountId);
  return buildGuardDecisionPayload({
    actionId: args.actionId || "SETTINGS_OWNER_ONLY",
    role: args.role || undefined,
    plan: guardPlan,
  });
}

function resolveSessionMemberRole(
  sess: { memberRole?: unknown } | null | undefined,
  fallback: "OWNER" | "ADMIN" | "MEMBER" | "ANON" = "ANON",
) {
  const normalized = String(sess?.memberRole || fallback).trim().toUpperCase();
  if (normalized === "OWNER" || normalized === "ADMIN" || normalized === "MEMBER") return normalized;
  return fallback;
}
function isCavCloudSettingsReadSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["CavCloudSettings", "CavCloudCollabPolicy", "CavCloudFolder", "Membership"],
    columns: [
      "themeAccent",
      "startLocation",
      "lastFolderId",
      "pinnedFolderId",
      "path",
      "deletedAt",
      "allowAdminsManageCollaboration",
      "allowMembersEditFiles",
      "allowMembersCreateUpload",
      "allowAdminsPublishArtifacts",
      "allowAdminsViewAccessLogs",
      "enableContributorLinks",
      "allowTeamAiAccess",
      "role",
    ],
  });
}

async function buildDegradedSettingsResponse(req: Request) {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);

  return jsonNoStore(
    {
      ok: true,
      degraded: true,
      settings: { ...DEFAULT_CAVCLOUD_SETTINGS },
      collabPolicy: { ...DEFAULT_CAVCLOUD_COLLAB_POLICY },
      memberRole: resolveSessionMemberRole(sess),
    },
    200,
  );
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    requireAccountRole(sess, ["OWNER"]);

    const accountId = String(sess.accountId || "");
    const userId = String(sess.sub || "");
    const [settings, collabPolicy] = await Promise.all([
      getCavCloudSettings({
        accountId,
        userId,
      }),
      getCavCloudCollabPolicy(accountId),
    ]);

    return jsonNoStore({
      ok: true,
      settings,
      collabPolicy,
      memberRole: resolveSessionMemberRole(sess, "OWNER"),
    }, 200);
  } catch (err) {
    const status = Number((err as { status?: unknown })?.status || 0);
    if (status === 403) {
      const sess = await requireSession(req).catch(() => null);
      const accountId = String(sess?.accountId || "");
      const memberRole = String(sess?.memberRole || "ANON").toUpperCase();
      const guardPayload = accountId
        ? await buildOwnerSettingsGuard({
            accountId,
            role: memberRole,
            actionId: "SETTINGS_OWNER_ONLY",
          })
        : buildGuardDecisionPayload({ actionId: "AUTH_REQUIRED" });
      return jsonNoStore(
        {
          ok: false,
          error: "UNAUTHORIZED",
          message: "Owner only.",
          ...(guardPayload || {}),
        },
        403,
      );
    }
    if (isCavCloudSettingsReadSchemaMismatch(err)) {
      try {
        return await buildDegradedSettingsResponse(req);
      } catch (fallbackError) {
        return cavcloudErrorResponse(fallbackError, "Failed to load CavCloud settings.");
      }
    }
    try {
      return await buildDegradedSettingsResponse(req);
    } catch {
      // Keep the original error payload when degraded auth fallback is unavailable.
    }
    return cavcloudErrorResponse(err, "Failed to load CavCloud settings.");
  }
}

async function saveSettings(req: Request) {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);
  if (sess.memberRole !== "OWNER") {
    return jsonNoStore(
      {
        ok: false,
        error: "UNAUTHORIZED",
        message: "Owner only.",
        ...(await buildOwnerSettingsGuard({
          accountId: String(sess.accountId || ""),
          role: sess.memberRole || null,
          actionId: "SETTINGS_OWNER_ONLY",
        })),
      },
      403,
    );
  }

  const accountId = String(sess.accountId || "");
  const userId = String(sess.sub || "");
  const memberRole = resolveSessionMemberRole(sess, "OWNER");
  const body = (await readSanitizedJson(req, null)) as unknown;
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
  const parsed = parseCavCloudSettingsPatch(payload || {});
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "BAD_SETTINGS_PAYLOAD", message: parsed.error }, 400);
  }

  const collabPatchInput = payload && typeof payload.collabPolicy === "object" && payload.collabPolicy != null
    ? payload.collabPolicy
    : payload;
  const collabParsed = parseCavCloudCollabPolicyPatch(collabPatchInput || {});
  if (!collabParsed.ok) {
    return jsonNoStore({ ok: false, error: "BAD_COLLAB_POLICY_PAYLOAD", message: collabParsed.error }, 400);
  }

  const wantsArcadeAccessEnabled =
    Object.prototype.hasOwnProperty.call(collabParsed.patch, "enableContributorLinks")
    && Boolean(collabParsed.patch.enableContributorLinks);

  if (wantsArcadeAccessEnabled) {
    const guardPlan = await resolveGuardPlan(accountId);
    if (guardPlan !== "PREMIUM_PLUS") {
      const guardPayload = buildGuardDecisionPayload({
        actionId: "ARCADE_CONTROLS_PLAN_REQUIRED",
        role: memberRole,
        plan: guardPlan,
      });
      return jsonNoStore(
        {
          ok: false,
          error: "PLAN_REQUIRED",
          message: "Premium+ required to enable Arcade access controls.",
          ...(guardPayload || {}),
        },
        403,
      );
    }
  }

  const [settings, collabPolicy] = await Promise.all([
    updateCavCloudSettings({
      accountId,
      userId,
      patch: parsed.patch,
    }),
    Object.keys(collabParsed.patch).length
      ? updateCavCloudCollabPolicy({
          accountId,
          patch: collabParsed.patch,
        })
      : getCavCloudCollabPolicy(accountId),
  ]);

  return jsonNoStore({
    ok: true,
    settings,
    collabPolicy,
  }, 200);
}

export async function PUT(req: Request) {
  try {
    return await saveSettings(req);
  } catch (err) {
    const status = Number((err as { status?: unknown })?.status || 0);
    if (status === 403) {
      const sess = await requireSession(req).catch(() => null);
      const accountId = String(sess?.accountId || "");
      const memberRole = String(sess?.memberRole || "ANON").toUpperCase();
      const guardPayload = accountId
        ? await buildOwnerSettingsGuard({
            accountId,
            role: memberRole,
            actionId: "SETTINGS_OWNER_ONLY",
          })
        : buildGuardDecisionPayload({ actionId: "AUTH_REQUIRED" });
      return jsonNoStore(
        {
          ok: false,
          error: "UNAUTHORIZED",
          message: "Owner only.",
          ...(guardPayload || {}),
        },
        403,
      );
    }
    return cavcloudErrorResponse(err, "Failed to update CavCloud settings.");
  }
}

export async function PATCH(req: Request) {
  try {
    return await saveSettings(req);
  } catch (err) {
    const status = Number((err as { status?: unknown })?.status || 0);
    if (status === 403) {
      const sess = await requireSession(req).catch(() => null);
      const accountId = String(sess?.accountId || "");
      const memberRole = String(sess?.memberRole || "ANON").toUpperCase();
      const guardPayload = accountId
        ? await buildOwnerSettingsGuard({
            accountId,
            role: memberRole,
            actionId: "SETTINGS_OWNER_ONLY",
          })
        : buildGuardDecisionPayload({ actionId: "AUTH_REQUIRED" });
      return jsonNoStore(
        {
          ok: false,
          error: "UNAUTHORIZED",
          message: "Owner only.",
          ...(guardPayload || {}),
        },
        403,
      );
    }
    return cavcloudErrorResponse(err, "Failed to update CavCloud settings.");
  }
}

import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  CAVSAFE_ENFORCED_POLICY_SUMMARY,
  getCavSafeSettings,
  parseCavSafeSettingsPatch,
  patchContainsPremiumPlusOnlyField,
  updateCavSafeSettings,
} from "@/lib/cavsafe/settings.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function tierFromSession(premiumPlus: boolean): "PREMIUM" | "PREMIUM_PLUS" {
  return premiumPlus ? "PREMIUM_PLUS" : "PREMIUM";
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);
    const settings = await getCavSafeSettings({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      premiumPlus: sess.cavsafePremiumPlus,
    });

    return jsonNoStore(
      {
        ok: true,
        tier: tierFromSession(sess.cavsafePremiumPlus),
        settings,
        enforcedPolicySummary: CAVSAFE_ENFORCED_POLICY_SUMMARY,
      },
      200,
    );
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load CavSafe settings.");
  }
}

async function saveSettings(req: Request) {
  const sess = await requireCavsafeOwnerSession(req);
  const body = (await readSanitizedJson(req, null)) as unknown;
  const parsed = parseCavSafeSettingsPatch(body);
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "BAD_SETTINGS_PAYLOAD", message: parsed.error }, 400);
  }

  if (!sess.cavsafePremiumPlus && patchContainsPremiumPlusOnlyField(parsed.patch)) {
    return jsonNoStore(
      {
        ok: false,
        error: "PLAN_UPGRADE_REQUIRED",
        message: "Upgrade to Premium+ to update this setting.",
      },
      403,
    );
  }

  const settings = await updateCavSafeSettings({
    accountId: String(sess.accountId || ""),
    userId: String(sess.sub || ""),
    patch: parsed.patch,
    premiumPlus: sess.cavsafePremiumPlus,
  });

  return jsonNoStore(
    {
      ok: true,
      tier: tierFromSession(sess.cavsafePremiumPlus),
      settings,
      enforcedPolicySummary: CAVSAFE_ENFORCED_POLICY_SUMMARY,
    },
    200,
  );
}

export async function PUT(req: Request) {
  try {
    return await saveSettings(req);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to update CavSafe settings.");
  }
}

export async function PATCH(req: Request) {
  try {
    return await saveSettings(req);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to update CavSafe settings.");
  }
}

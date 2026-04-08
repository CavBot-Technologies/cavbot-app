import "server-only";

import { headers } from "next/headers";
import { getAppOrigin, getSession } from "@/lib/apiAuth";
import {
  compareMembershipPriority,
  findMembershipsForUser,
  findSessionMembership,
  findUserById,
  getAuthPool,
  membershipTierRank,
  pickPrimaryMembership,
} from "@/lib/authDb";
import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import { normalizeCavbotFounderProfile } from "@/lib/profileIdentity";
import type { CavbotClientAuthBootstrap, ClientBootPlanState } from "@/lib/clientAuthBootstrap";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";

function s(value: unknown) {
  return String(value ?? "").trim();
}

function parseDateMs(value: unknown) {
  if (!value) return null;
  try {
    const ms = new Date(String(value)).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function planTierForId(planId: PlanId): ClientBootPlanState["planTier"] {
  if (planId === "premium_plus") return "PREMIUM_PLUS";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

function planLabelForId(planId: PlanId): ClientBootPlanState["planLabel"] {
  if (planId === "premium_plus") return "PREMIUM+";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

function firstInitialChar(input: string) {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function deriveInitials(displayName?: string | null, username?: string | null) {
  const name = String(displayName || "").trim();
  if (name) {
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const duo = `${firstInitialChar(parts[0] || "")}${firstInitialChar(parts[1] || "")}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }
  const usernameInitial = firstInitialChar(String(username || "").trim().replace(/^@+/, ""));
  return usernameInitial || "C";
}

function trialDaysLeft(trialActive: boolean, endsAt: unknown) {
  const endsAtMs = parseDateMs(endsAt);
  if (!trialActive || !endsAtMs) return 0;
  const diff = endsAtMs - Date.now();
  if (diff <= 0) return 0;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function jsonForInlineScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function buildRequestFromHeaders() {
  const headerStore = headers();
  const cookie = s(headerStore.get("cookie"));
  if (!cookie) return null;

  const fallback = new URL(getAppOrigin());
  const host = s(headerStore.get("x-forwarded-host") || headerStore.get("host") || fallback.host);
  const proto = s(headerStore.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")) || "https";

  return new Request(`${proto}://${host}/_bootstrap`, {
    headers: {
      cookie,
      host,
    },
  });
}

export async function readClientAuthBootstrapServerState(): Promise<CavbotClientAuthBootstrap> {
  const req = await buildRequestFromHeaders();
  if (!req) {
    return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
  }

  try {
    const sess = await getSession(req);
    if (!sess || sess.systemRole !== "user") {
      return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
    }

    const userId = s(sess.sub);
    const accountId = s(sess.accountId);
    if (!userId) {
      return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
    }

    const pool = getAuthPool();
    const currentMembership = accountId ? await findSessionMembership(pool, userId, accountId) : null;
    const memberships = await findMembershipsForUser(pool, userId).catch(() => []);
    const primaryMembership = pickPrimaryMembership(memberships);
    const shouldPromoteMembership = primaryMembership
      ? (
          !currentMembership
          || (
            primaryMembership.accountId !== currentMembership.accountId
            && membershipTierRank(primaryMembership.accountTier) > membershipTierRank(currentMembership.accountTier)
            && compareMembershipPriority(primaryMembership, currentMembership) < 0
          )
        )
      : false;
    const promotedMembership = shouldPromoteMembership && primaryMembership
      ? await findSessionMembership(pool, userId, primaryMembership.accountId)
      : null;
    const primaryMembershipRecord = !currentMembership && !promotedMembership && primaryMembership
      ? await findSessionMembership(pool, userId, primaryMembership.accountId)
      : null;
    const effectiveMembership = promotedMembership ?? currentMembership ?? primaryMembershipRecord;
    if (!effectiveMembership) {
      return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
    }

    const [user, effectivePlan] = await Promise.all([
      findUserById(pool, userId),
      getEffectiveAccountPlanContext(effectiveMembership.accountId).catch(() => null),
    ]);
    if (!user) {
      return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
    }

    const identity = normalizeCavbotFounderProfile({
      username: user.username,
      displayName: user.displayName,
      fullName: user.fullName,
    });
    const fullName = s(identity.fullName || identity.displayName);
    const username = s(identity.username).toLowerCase();
    const planId = effectivePlan?.planId ?? resolvePlanIdFromTier(effectiveMembership.accountTier || "free");
    const trialActive = Boolean(effectivePlan?.trialActive);
    const trialDays = trialDaysLeft(trialActive, effectivePlan?.account?.trialEndsAt);

    return {
      authenticated: true,
      session: {
        userId,
        accountId: effectiveMembership.accountId,
        memberRole: effectiveMembership.role,
      },
      profile: {
        fullName,
        email: s(user.email),
        username,
        initials: deriveInitials(fullName, username),
        avatarTone: s(user.avatarTone).toLowerCase() || "lime",
        avatarImage: s(user.avatarImage),
        publicProfileEnabled: typeof user.publicProfileEnabled === "boolean" ? user.publicProfileEnabled : null,
      },
      plan: {
        planId,
        planTier: planTierForId(planId),
        planLabel: planLabelForId(planId),
        memberRole: effectiveMembership.role,
        trialActive,
        trialDaysLeft: trialDays,
      },
      ts: Date.now(),
    };
  } catch {
    return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
  }
}

export function buildClientAuthBootstrapScript(payload: CavbotClientAuthBootstrap) {
  const serialized = jsonForInlineScript(payload);
  return `(function(){var boot=${serialized};globalThis.__CB_AUTH_BOOTSTRAP__=boot;var store=globalThis.__cbLocalStore;if(!store)return;function set(k,v){try{store.setItem(k,String(v??""))}catch{}}function remove(k){try{store.removeItem(k)}catch{}}function setJson(k,v){try{store.setItem(k,JSON.stringify(v))}catch{}}if(boot&&boot.authenticated&&boot.plan){var snapshot={planTier:boot.plan.planTier,memberRole:boot.plan.memberRole||null,trialActive:!!boot.plan.trialActive,trialDaysLeft:boot.plan.trialActive?Math.max(0,Math.trunc(Number(boot.plan.trialDaysLeft||0))||0):0,ts:Number(boot.ts||Date.now())||Date.now()};var detail={planKey:boot.plan.planId,planLabel:boot.plan.planLabel,planTier:boot.plan.planTier,memberRole:boot.plan.memberRole||null,trialActive:!!boot.plan.trialActive,trialDaysLeft:snapshot.trialDaysLeft};setJson("cb_shell_plan_snapshot_v1",snapshot);setJson("cb_plan_context_v1",detail);if(boot.profile){set("cb_profile_fullName_v1",boot.profile.fullName||"");set("cb_profile_email_v1",boot.profile.email||"");set("cb_profile_username_v1",boot.profile.username||"");set("cb_account_initials",boot.profile.initials||"");set("cb_settings_avatar_tone_v2",boot.profile.avatarTone||"lime");if(boot.profile.avatarImage){set("cb_settings_avatar_image_v2",boot.profile.avatarImage);}else{remove("cb_settings_avatar_image_v2");}if(typeof boot.profile.publicProfileEnabled==="boolean"){set("cb_profile_public_enabled_v1",boot.profile.publicProfileEnabled?"true":"false");}else{remove("cb_profile_public_enabled_v1");}}set("cb_profile_rev_v1",String(Number(boot.ts||Date.now())||Date.now()));return;}remove("cb_shell_plan_snapshot_v1");remove("cb_plan_context_v1");remove("cb_profile_fullName_v1");remove("cb_profile_email_v1");remove("cb_profile_username_v1");remove("cb_account_initials");remove("cb_profile_public_enabled_v1");remove("cb_settings_avatar_image_v2");set("cb_settings_avatar_tone_v2","lime");})();`;
}

import "server-only";

import { headers } from "next/headers";
import { getAppOrigin, readVerifiedSession } from "@/lib/apiAuth";
import type { CavbotClientAuthBootstrap } from "@/lib/clientAuthBootstrap";

function s(value: unknown) {
  return String(value ?? "").trim();
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
    const sess = await readVerifiedSession(req);
    if (!sess || sess.systemRole !== "user") {
      return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
    }

    const userId = s(sess.sub);
    const accountId = s(sess.accountId);
    const memberRole = s(sess.memberRole).toUpperCase();
    if (!userId || !accountId || (memberRole !== "OWNER" && memberRole !== "ADMIN" && memberRole !== "MEMBER")) {
      return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
    }

    return {
      authenticated: true,
      session: {
        userId,
        accountId,
        memberRole: memberRole as "OWNER" | "ADMIN" | "MEMBER",
      },
      profile: null,
      plan: null,
      ts: Date.now(),
    };
  } catch {
    return { authenticated: false, session: null, profile: null, plan: null, ts: Date.now() };
  }
}

export function buildClientAuthBootstrapScript(payload: CavbotClientAuthBootstrap) {
  const serialized = jsonForInlineScript(payload);
  return `(function(){var boot=${serialized};globalThis.__CB_AUTH_BOOTSTRAP__=boot;var store=globalThis.__cbLocalStore;if(!store)return;function set(k,v){try{store.setItem(k,String(v??""))}catch{}}function remove(k){try{store.removeItem(k)}catch{}}function setJson(k,v){try{store.setItem(k,JSON.stringify(v))}catch{}}if(!boot||!boot.authenticated){remove("cb_shell_plan_snapshot_v1");remove("cb_plan_context_v1");remove("cb_profile_fullName_v1");remove("cb_profile_email_v1");remove("cb_profile_username_v1");remove("cb_account_initials");remove("cb_profile_public_enabled_v1");remove("cb_settings_avatar_image_v2");set("cb_settings_avatar_tone_v2","lime");return;}if(boot.plan){var snapshot={planTier:boot.plan.planTier,memberRole:boot.plan.memberRole||null,trialActive:!!boot.plan.trialActive,trialDaysLeft:boot.plan.trialActive?Math.max(0,Math.trunc(Number(boot.plan.trialDaysLeft||0))||0):0,ts:Number(boot.ts||Date.now())||Date.now()};var detail={planKey:boot.plan.planId,planLabel:boot.plan.planLabel,planTier:boot.plan.planTier,memberRole:boot.plan.memberRole||null,trialActive:!!boot.plan.trialActive,trialDaysLeft:snapshot.trialDaysLeft};setJson("cb_shell_plan_snapshot_v1",snapshot);setJson("cb_plan_context_v1",detail);}if(boot.profile){set("cb_profile_fullName_v1",boot.profile.fullName||"");set("cb_profile_email_v1",boot.profile.email||"");set("cb_profile_username_v1",boot.profile.username||"");set("cb_account_initials",boot.profile.initials||"");set("cb_settings_avatar_tone_v2",boot.profile.avatarTone||"lime");if(boot.profile.avatarImage){set("cb_settings_avatar_image_v2",boot.profile.avatarImage);}else{remove("cb_settings_avatar_image_v2");}if(typeof boot.profile.publicProfileEnabled==="boolean"){set("cb_profile_public_enabled_v1",boot.profile.publicProfileEnabled?"true":"false");}else{remove("cb_profile_public_enabled_v1");}}set("cb_profile_rev_v1",String(Number(boot.ts||Date.now())||Date.now()));})();`;
}

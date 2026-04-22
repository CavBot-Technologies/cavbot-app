import "server-only";

import type { PlanId } from "@/lib/plans";
import { findLatestEntitledSubscription, resolveEffectivePlanId } from "@/lib/accountPlan.server";
import type { AdminTrackedAgentRecord } from "@/lib/admin/agentIntelligence.server";
import { getAdminTrackedAgentRecord, syncAdminTrackedAgents } from "@/lib/admin/agentIntelligence.server";
import type { CavenCustomAgent, CavenSettings } from "@/lib/cavai/cavenSettings.server";
import { getCavenSettings, updateCavenSettings } from "@/lib/cavai/cavenSettings.server";
import type { PublishedOperatorAgentRecord } from "@/lib/cavai/operatorAgents.server";
import {
  removePublishedOperatorAgent,
  upsertPublishedOperatorAgent,
} from "@/lib/cavai/operatorAgents.server";
import { prisma } from "@/lib/prisma";

type ManagedAgentContext = {
  tracked: AdminTrackedAgentRecord;
  settings: CavenSettings;
  customAgent: CavenCustomAgent;
  planId: PlanId;
};

function s(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveManagedAgentContext(args: {
  accountId: string;
  userId: string;
  agentId: string;
}): Promise<ManagedAgentContext | null> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const agentId = s(args.agentId).toLowerCase();
  if (!accountId || !userId || !agentId) return null;

  const tracked = await getAdminTrackedAgentRecord({ accountId, userId, agentId });
  if (!tracked) return null;

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      tier: true,
      trialSeatActive: true,
      trialEndsAt: true,
    },
  });

  const subscription = await findLatestEntitledSubscription(accountId);
  const planId = resolveEffectivePlanId({
    account,
    subscription,
  });

  const settings = await getCavenSettings({
    accountId,
    userId,
    planId,
  });
  const customAgent = settings.customAgents.find((agent) => s(agent.id).toLowerCase() === agentId) || null;
  if (!customAgent) return null;

  return {
    tracked,
    settings,
    customAgent,
    planId,
  };
}

async function persistCustomAgents(args: {
  accountId: string;
  userId: string;
  planId: PlanId;
  customAgents: CavenCustomAgent[];
}): Promise<CavenSettings> {
  const settings = await updateCavenSettings({
    accountId: args.accountId,
    userId: args.userId,
    planId: args.planId,
    patch: {
      customAgents: args.customAgents,
    },
  });
  await syncAdminTrackedAgents({
    accountId: args.accountId,
    userId: args.userId,
    agents: settings.customAgents,
  });
  return settings;
}

export async function publishAdminTrackedCustomAgent(args: {
  accountId: string;
  userId: string;
  agentId: string;
}): Promise<{ tracked: AdminTrackedAgentRecord; settings: CavenSettings; published: PublishedOperatorAgentRecord | null } | null> {
  const ctx = await resolveManagedAgentContext(args);
  if (!ctx) return null;

  const nowIso = new Date().toISOString();
  const nextCustomAgents = ctx.settings.customAgents.map((agent) => (
    s(agent.id).toLowerCase() === ctx.tracked.agentId
      ? {
          ...agent,
          publicationRequested: true,
          publicationRequestedAt: agent.publicationRequestedAt || nowIso,
        }
      : agent
  ));

  const settings = await persistCustomAgents({
    accountId: ctx.tracked.accountId,
    userId: ctx.tracked.userId,
    planId: ctx.planId,
    customAgents: nextCustomAgents,
  });

  const nextAgent = settings.customAgents.find((agent) => s(agent.id).toLowerCase() === ctx.tracked.agentId) || null;
  if (!nextAgent) {
    return {
      tracked: ctx.tracked,
      settings,
      published: null,
    };
  }

  const published = await upsertPublishedOperatorAgent({
    accountId: ctx.tracked.accountId,
    userId: ctx.tracked.userId,
    publishedAt: nowIso,
    agent: {
      id: nextAgent.id,
      name: nextAgent.name,
      summary: nextAgent.summary,
      actionKey: nextAgent.actionKey,
      surface: nextAgent.surface,
      triggers: nextAgent.triggers,
      instructions: nextAgent.instructions,
      iconSvg: nextAgent.iconSvg,
      iconBackground: nextAgent.iconBackground,
      publicationRequested: true,
      publicationRequestedAt: nextAgent.publicationRequestedAt || nowIso,
    },
  });

  return {
    tracked: ctx.tracked,
    settings,
    published,
  };
}

export async function unpublishAdminTrackedCustomAgent(args: {
  accountId: string;
  userId: string;
  agentId: string;
}): Promise<{ tracked: AdminTrackedAgentRecord; settings: CavenSettings } | null> {
  const ctx = await resolveManagedAgentContext(args);
  if (!ctx) return null;

  const nextCustomAgents = ctx.settings.customAgents.map((agent) => (
    s(agent.id).toLowerCase() === ctx.tracked.agentId
      ? {
          ...agent,
          publicationRequested: false,
          publicationRequestedAt: null,
        }
      : agent
  ));

  const settings = await persistCustomAgents({
    accountId: ctx.tracked.accountId,
    userId: ctx.tracked.userId,
    planId: ctx.planId,
    customAgents: nextCustomAgents,
  });

  await removePublishedOperatorAgent({
    userId: ctx.tracked.userId,
    agentId: ctx.tracked.agentId,
  });

  return {
    tracked: ctx.tracked,
    settings,
  };
}

export async function deleteAdminTrackedCustomAgent(args: {
  accountId: string;
  userId: string;
  agentId: string;
}): Promise<{ tracked: AdminTrackedAgentRecord; settings: CavenSettings } | null> {
  const ctx = await resolveManagedAgentContext(args);
  if (!ctx) return null;

  const nextCustomAgents = ctx.settings.customAgents.filter(
    (agent) => s(agent.id).toLowerCase() !== ctx.tracked.agentId,
  );

  const settings = await persistCustomAgents({
    accountId: ctx.tracked.accountId,
    userId: ctx.tracked.userId,
    planId: ctx.planId,
    customAgents: nextCustomAgents,
  });

  await removePublishedOperatorAgent({
    userId: ctx.tracked.userId,
    agentId: ctx.tracked.agentId,
  });

  return {
    tracked: ctx.tracked,
    settings,
  };
}

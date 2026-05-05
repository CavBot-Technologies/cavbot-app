// app/api/workspaces/[projectId]/guardrails/route.ts
import { NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import { findAccountWorkspaceProject } from "@/lib/workspaceProjects.server";
import {
  defaultWorkspaceProjectGuardrails,
  ensureWorkspaceProjectGuardrails,
  getWorkspaceProjectGuardrails,
} from "@/lib/workspaceGuardrails.server";
import { requireWorkspaceSession } from "@/lib/workspaceAuth.server";
import { withCavCloudDeadline } from "@/lib/cavcloud/http.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(data: unknown, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function parseProjectId(raw: string): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const ALLOWED_KEYS = [
  "blockUnknownOrigins",
  "enforceAllowlist",
  "alertOn404Spike",
  "alertOnJsSpike",
  "strictDeletion",
] as const;

type GuardrailKey = (typeof ALLOWED_KEYS)[number];

function pickBooleanPatch(patch: unknown) {
  const data: Partial<Record<GuardrailKey, boolean>> = {};
  if (typeof patch !== "object" || patch === null) return data;
  const asObj = patch as Record<string, unknown>;
  for (const k of ALLOWED_KEYS) {
    if (typeof asObj[k] === "boolean") data[k] = asObj[k] as boolean;
  }
  return data;
}

// Next 15+ params can be a Promise — always await it safely
async function getParams(ctx: unknown): Promise<{ projectId?: string }> {
  const params = typeof ctx === "object" && ctx !== null ? (ctx as { params?: { projectId?: string } }).params ?? {} : {};
  return Promise.resolve(params);
}

export async function GET(req: Request, ctx: unknown) {
  try {
    const sess = await withCavCloudDeadline(requireWorkspaceSession(req), {
      timeoutMs: 1_500,
      message: "Workspace session lookup timed out.",
    });

    const params = await getParams(ctx);
    const projectId = parseProjectId(params?.projectId || "");
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const project = await withCavCloudDeadline(
      findAccountWorkspaceProject({
        accountId: sess.accountId!,
        projectId,
        select: { id: true },
      }),
      {
        timeoutMs: 1_800,
        message: "Workspace project lookup timed out.",
      },
    );
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const guardrails = await withCavCloudDeadline(getWorkspaceProjectGuardrails(project.id), {
      timeoutMs: 1_800,
      message: "Workspace guardrails lookup timed out.",
    });

    return json({ guardrails }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    return json({ ok: true, degraded: true, guardrails: defaultWorkspaceProjectGuardrails() }, 200);
  }
}

export async function PATCH(req: Request, ctx: unknown) {
  try {
    const sess = await requireWorkspaceSession(req);

    const params = await getParams(ctx);
    const projectId = parseProjectId(params?.projectId || "");
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const project = await findAccountWorkspaceProject({
      accountId: sess.accountId!,
      projectId,
      select: { id: true },
    });
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const patch = await readSanitizedJson(req, null);
    const data = pickBooleanPatch(patch);

    if (Object.keys(data).length === 0) return json({ error: "NO_CHANGES" }, 400);

    const guardrails = await ensureWorkspaceProjectGuardrails(project.id, data);

    return json({ guardrails }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}

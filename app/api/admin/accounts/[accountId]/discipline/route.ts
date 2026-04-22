import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import {
  getAccountDisciplineState,
  restoreAccount,
  revokeAccount,
  suspendAccount,
} from "@/lib/admin/accountDiscipline.server";
import { requireAdminAccess } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type ActionBody = {
  action?: unknown;
  durationDays?: unknown;
  note?: unknown;
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: {
      ...(base.headers || {}),
      ...NO_STORE_HEADERS,
    },
  });
}

function s(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDurationDays(value: unknown) {
  const days = Number(value);
  return days === 7 || days === 14 || days === 30 ? days : null;
}

function serializeDiscipline(state: Awaited<ReturnType<typeof getAccountDisciplineState>>) {
  if (!state) return null;
  return {
    accountId: state.accountId,
    status: state.status,
    violationCount: state.violationCount,
    suspendedUntilISO: state.suspendedUntilISO,
    suspensionDays: state.suspensionDays,
    revokedAtISO: state.revokedAtISO,
    updatedAtISO: state.updatedAtISO,
    note: state.note,
  };
}

export async function POST(req: NextRequest, { params }: { params: { accountId: string } }) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req, { scopes: ["accounts.read"] });
    const accountId = s(params.accountId);
    const body = (await readSanitizedJson(req, {} as ActionBody)) as ActionBody;
    const action = s(body.action).toLowerCase();
    const note = s(body.note) || null;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });
    if (!account?.id) return json({ ok: false, error: "ACCOUNT_NOT_FOUND" }, 404);

    const before = serializeDiscipline(await getAccountDisciplineState(accountId));

    if (action === "restore") {
      const restored = serializeDiscipline(await restoreAccount({
        accountId,
        actorStaffId: ctx.staff.id,
        note,
      }));
      await writeAdminAuditLog({
        actorStaffId: ctx.staff.id,
        actorUserId: ctx.userSession.sub,
        action: "ACCOUNT_ACCESS_RESTORED",
        actionLabel: "Workspace access restored",
        entityType: "account",
        entityId: account.id,
        entityLabel: account.name,
        request: req,
        beforeJson: before,
        afterJson: restored,
      });
      return json({ ok: true, account: { id: account.id, name: account.name }, discipline: restored }, 200);
    }

    if (action === "revoke") {
      const revoked = serializeDiscipline(await revokeAccount({
        accountId,
        actorStaffId: ctx.staff.id,
        note,
      }));
      await writeAdminAuditLog({
        actorStaffId: ctx.staff.id,
        actorUserId: ctx.userSession.sub,
        action: "ACCOUNT_REVOKED",
        actionLabel: "Workspace access revoked",
        entityType: "account",
        entityId: account.id,
        entityLabel: account.name,
        request: req,
        severity: "destructive",
        beforeJson: before,
        afterJson: revoked,
      });
      return json({ ok: true, account: { id: account.id, name: account.name }, discipline: revoked }, 200);
    }

    if (action !== "suspend") {
      return json({ ok: false, error: "BAD_ACTION" }, 400);
    }

    const durationDays = normalizeDurationDays(body.durationDays);
    if (!durationDays) return json({ ok: false, error: "BAD_DURATION" }, 400);
    const result = await suspendAccount({
      accountId,
      actorStaffId: ctx.staff.id,
      durationDays,
      note,
    });
    const after = serializeDiscipline(result.state);
    await writeAdminAuditLog({
      actorStaffId: ctx.staff.id,
      actorUserId: ctx.userSession.sub,
      action: result.escalatedToRevoke ? "ACCOUNT_REVOKED" : "ACCOUNT_SUSPENDED",
      actionLabel: result.escalatedToRevoke ? "Workspace access revoked" : "Workspace access suspended",
      entityType: "account",
      entityId: account.id,
      entityLabel: account.name,
      request: req,
      severity: result.escalatedToRevoke ? "destructive" : "warning",
      beforeJson: before,
      afterJson: after,
      metaJson: {
        suspensionDays: durationDays,
        escalatedToRevoke: result.escalatedToRevoke,
      },
    });
    return json({
      ok: true,
      account: { id: account.id, name: account.name },
      discipline: after,
      escalatedToRevoke: result.escalatedToRevoke,
    }, 200);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "ACCOUNT_DISCIPLINE_FAILED" }, 500);
  }
}

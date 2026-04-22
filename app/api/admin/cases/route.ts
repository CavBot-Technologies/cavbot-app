import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { resolveAdminDepartment } from "@/lib/admin/access";
import { adminJson, safeId, safeText } from "@/lib/admin/api";
import { ensureAdminCase, listAdminCases, syncOperationalCasesFromSignals, updateAdminCase } from "@/lib/admin/cases.server";
import { requireAdminAccess } from "@/lib/admin/staff";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCaseManagementOwner(staff: { systemRole: string; scopes?: string[] | null }) {
  const department = resolveAdminDepartment(staff);
  return department === "COMMAND" || department === "SECURITY";
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAdminAccess(req, { scopes: ["security.read"] });
    if (!isCaseManagementOwner(ctx.staff)) {
      return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
    }
    await syncOperationalCasesFromSignals();
    const url = new URL(req.url);
    const cases = await listAdminCases({
      queue: url.searchParams.get("queue"),
      status: url.searchParams.get("status"),
      assigneeStaffId: url.searchParams.get("assigneeStaffId"),
      search: url.searchParams.get("search"),
      take: Number(url.searchParams.get("take") || 60),
    });
    return adminJson({ ok: true, cases });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({ ok: false, error: "CASES_READ_FAILED" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req, { scopes: ["security.write"] });
    if (!isCaseManagementOwner(ctx.staff)) {
      return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
    }

    const body = (await readSanitizedJson(req, {})) as Record<string, unknown>;
    const action = safeId(body.action).toLowerCase();

    if (action === "sync") {
      const synced = await syncOperationalCasesFromSignals();
      return adminJson({ ok: true, synced });
    }

    if (action === "create") {
      const created = await ensureAdminCase({
        queue: String(body.queue || "CUSTOMER_SUCCESS").toUpperCase() as never,
        priority: String(body.priority || "MEDIUM").toUpperCase() as never,
        status: String(body.status || "OPEN").toUpperCase() as never,
        sourceKey: safeId(body.sourceKey) || null,
        subject: safeText(body.subject, 180),
        description: safeText(body.description, 4000) || null,
        accountId: safeId(body.accountId) || null,
        userId: safeId(body.userId) || null,
        linkedThreadId: safeId(body.linkedThreadId) || null,
        linkedCampaignId: safeId(body.linkedCampaignId) || null,
        assigneeStaffId: safeId(body.assigneeStaffId) || null,
        assigneeUserId: safeId(body.assigneeUserId) || null,
        slaDueAt: body.slaDueAt ? new Date(String(body.slaDueAt)) : null,
        meta: body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? (body.meta as never) : undefined,
      });
      return adminJson({ ok: true, case: created });
    }

    const updated = await updateAdminCase({
      caseId: safeId(body.caseId),
      status: safeId(body.status) || null,
      priority: safeId(body.priority) || null,
      queue: safeId(body.queue) || null,
      assigneeStaffId: safeId(body.assigneeStaffId) || null,
      assigneeUserId: safeId(body.assigneeUserId) || null,
      slaDueAt: body.slaDueAt ? new Date(String(body.slaDueAt)) : undefined,
      outcome: safeText(body.outcome, 4000) || null,
      customerNotified: typeof body.customerNotified === "boolean" ? body.customerNotified : null,
      note: safeText(body.note, 4000) || null,
      actorStaffId: ctx.staff.id,
    });

    return adminJson({ ok: true, case: updated });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CASE_WRITE_FAILED",
    }, 500);
  }
}

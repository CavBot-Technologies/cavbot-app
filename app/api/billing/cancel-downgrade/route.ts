// app/api/billing/cancel-downgrade/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isApiAuthError } from "@/lib/apiAuth";
import { getStripe } from "@/lib/stripeClient";
import { auditLogWrite } from "@/lib/audit";
import { requireBillingManageRole, resolveBillingAccountContext } from "@/lib/billingAccount.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, { ...resInit, headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS } });
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);

    const accountId = billingCtx.accountId;
    const operatorUserId = billingCtx.userId;
    const now = new Date();

    // Find latest Stripe subscription
    const latestStripeSub = await prisma.subscription.findFirst({
      where: { accountId, provider: "stripe", stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { stripeSubscriptionId: true },
    });

    if (latestStripeSub?.stripeSubscriptionId) {
      const sub = await (await getStripe()).subscriptions.retrieve(String(latestStripeSub.stripeSubscriptionId));

      // Undo cancel_at_period_end if it was set
      if (sub.cancel_at_period_end) {
        await (await getStripe()).subscriptions.update(sub.id, { cancel_at_period_end: false });
      }

      // If a schedule exists, release it
      const scheduleId = sub.schedule || null;
      if (scheduleId) {
        try {
          await (await getStripe()).subscriptionSchedules.release(String(scheduleId));
        } catch {
          // If already released/canceled, ignore
        }
      }
    }

    const prev = await prisma.account.findUnique({
      where: { id: accountId },
      select: { pendingDowngradePlanId: true, pendingDowngradeBilling: true, pendingDowngradeAt: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: {
          pendingDowngradePlanId: null,
          pendingDowngradeBilling: null,
          pendingDowngradeAt: null,
          pendingDowngradeEffectiveAt: null,
          pendingDowngradeAppliesAtRenewal: true,
        },
      });
    });

    if (accountId) {
      await auditLogWrite({
        request: req,
        action: "BILLING_UPDATED",
        accountId,
        operatorUserId,
        targetType: "billing",
        targetId: accountId,
        targetLabel: accountId,
        metaJson: {
          billing_event: "downgrade_canceled",
          prev: prev || null,
          canceledAt: now.toISOString(),
        },
      });
    }

    return json({ ok: true }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "BILLING_CANCEL_DOWNGRADE_FAILED", message: "Failed to cancel downgrade." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}

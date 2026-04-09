// app/api/stripe/webhook/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripeClient";
import { planFromPriceId } from "@/lib/stripe";
import { type PlanId, resolvePlanIdFromTier } from "@/lib/plans";
import { sendEmail } from "@/lib/email/sendEmail";
import type { BillingCycle, NotificationSettings, NoticeTone, PlanTier } from "@prisma/client";
import { auditLogWrite } from "@/lib/audit";
import { applyPlanTransition, handleBillingCycleReset } from "@/src/lib/ai/qwen-coder-credits.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type JsonResponsePayload = Record<string, unknown>;

function ok(res?: JsonResponsePayload) {
  return NextResponse.json(res ?? { ok: true }, { headers: NO_STORE_HEADERS });
}

function fail(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

function env(name: string) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function toDateFromUnixSec(sec: number | null | undefined) {
  if (!sec || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000);
}

function planToTier(planId: "premium" | "premium_plus"): PlanTier {
  return planId === "premium_plus" ? "ENTERPRISE" : "PREMIUM";
}

function billingToEnum(billing: "monthly" | "annual"): BillingCycle {
  return billing === "annual" ? "annual" : "monthly";
}

function tierRank(tier: string) {
  const t = String(tier || "").toUpperCase();
  if (t === "ENTERPRISE") return 2;
  if (t === "PREMIUM") return 1;
  return 0;
}

function planRank(planId: PlanId): number {
  if (planId === "premium_plus") return 2;
  if (planId === "premium") return 1;
  return 0;
}

function transitionType(oldPlan: PlanId, nextPlan: PlanId): "upgrade" | "downgrade" | "sync" {
  if (oldPlan === nextPlan) return "sync";
  return planRank(nextPlan) > planRank(oldPlan) ? "upgrade" : "downgrade";
}

function fmtMoney(cents: number | null | undefined, currency?: string | null) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  const curr = String(currency || "usd").toUpperCase();
  const val = (cents / 100).toFixed(2);
  return `${curr} ${val}`;
}

async function findAccountIdByStripeCustomer(stripeCustomerId: string | null): Promise<string | null> {
  if (!stripeCustomerId) return null;
  const a = await prisma.account.findFirst({
    where: { stripeCustomerId },
    select: { id: true },
  });
  return a?.id || null;
}

async function syncQwenPlanTransitionForAccount(args: {
  accountId: string;
  oldPlan: PlanId;
  newPlan: PlanId;
  eventSource: string;
}) {
  const eventType = transitionType(args.oldPlan, args.newPlan);
  const members = await prisma.membership.findMany({
    where: { accountId: args.accountId },
    select: { userId: true },
  });
  await Promise.all(
    members.map((member) =>
      applyPlanTransition({
        accountId: args.accountId,
        userId: member.userId,
        oldPlan: args.oldPlan,
        newPlan: args.newPlan,
        eventType,
        eventSource: args.eventSource,
      }).catch(() => {})
    )
  );
}

async function upsertSubscriptionFromStripe(args: {
  request: NextRequest;
  accountId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  priceId: string | null;
  planId: "premium" | "premium_plus";
  billing: "monthly" | "annual";
  status: "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED";
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}) {
  const nextTier = planToTier(args.planId);

  await prisma.$transaction(async (tx) => {
    // Account tier mirrors Stripe subscription state (source-of-truth)
    await tx.account.update({
      where: { id: args.accountId },
      data: {
        stripeCustomerId: args.stripeCustomerId || undefined,
        tier: args.status === "CANCELED" ? "FREE" : nextTier,
      },
    });

    const existing = await tx.subscription.findFirst({
      where: { accountId: args.accountId, provider: "stripe" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const subData = {
      provider: "stripe",
      customerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripePriceId: args.priceId,
      billingCycle: billingToEnum(args.billing),
      status: args.status,
      tier: args.status === "CANCELED" ? "FREE" : nextTier,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
    };

    if (existing?.id) {
      await tx.subscription.update({ where: { id: existing.id }, data: subData });
    } else {
      await tx.subscription.create({ data: { accountId: args.accountId, ...subData } });
    }

    // Clear pending downgrade if subscription is active on a paid tier again
    if (args.status !== "CANCELED") {
      await tx.account.update({
        where: { id: args.accountId },
        data: {
          pendingDowngradePlanId: null,
          pendingDowngradeBilling: null,
          pendingDowngradeAt: null,
          pendingDowngradeEffectiveAt: null,
          pendingDowngradeAppliesAtRenewal: true,
        },
      });
    }

    if (args.accountId) {
      await auditLogWrite({
        request: args.request,
        action: "BILLING_UPDATED",
        accountId: args.accountId,
        operatorUserId: null,
        targetType: "billing",
        targetId: args.accountId,
        targetLabel: args.stripeCustomerId || args.accountId,
        metaJson: {
          billing_event: "stripe_subscription_sync",
          planId: args.planId,
          billing: args.billing,
          status: args.status,
          stripeSubscriptionId: args.stripeSubscriptionId,
          stripePriceId: args.priceId,
          currentPeriodStart: args.currentPeriodStart ? args.currentPeriodStart.toISOString() : null,
          currentPeriodEnd: args.currentPeriodEnd ? args.currentPeriodEnd.toISOString() : null,
        },
      });
    }
  });
}

async function dedupeStripeEvent(event: Stripe.Event, accountId?: string | null) {
  // Create StripeEvent row once. If it already exists => deduped.
  try {
    await prisma.stripeEvent.create({
      data: {
        id: event.id,
        type: event.type,
        livemode: Boolean(event.livemode),
        accountId: accountId || null,
        processedAt: null,
      },
    });
    return { firstTime: true };
  } catch {
    // Unique violation (or already exists) => dedupe
    return { firstTime: false };
  }
}

async function markProcessed(eventId: string, accountId: string | null) {
  try {
    await prisma.stripeEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date(), accountId: accountId || null },
    });
  } catch {
    // If stripeEvent row doesn't exist for any reason, do not fail webhook.
  }
}

async function getOwnerContacts(accountId: string) {
  const owners = await prisma.membership.findMany({
    where: { accountId, role: "OWNER" },
    select: {
      userId: true,
      user: { select: { email: true } },
    },
  });
  return owners;
}

function isNotificationEventEnabled(settings: NotificationSettings | null | undefined, eventKey?: EventKey) {
  if (!eventKey) return true;
  if (!settings) return true;
  const key = eventKey as keyof NotificationSettings;
  const value = settings[key];
  return typeof value === "boolean" ? value : true;
}

type EventKey =
  | "evtSubDue"
  | "evtSubRenewed"
  | "evtSubExpired"
  | "evtUpgraded"
  | "evtDowngraded";

async function notifyOwners(args: {
  accountId: string;
  title: string;
  body: string;
  tone?: NoticeTone;
  eventKey?: EventKey;
  emailSubject?: string;
  emailHtml?: string;
  dedupeHours?: number;
}) {
  const owners = await getOwnerContacts(args.accountId);
  if (!owners.length) return;

  await Promise.all(
    owners.map(async (owner) => {
      let shouldSend = true;
      if (args.dedupeHours && args.dedupeHours > 0) {
        const since = new Date(Date.now() - args.dedupeHours * 60 * 60 * 1000);
        const recent = await prisma.notification.findFirst({
          where: {
            userId: owner.userId,
            accountId: args.accountId,
            title: args.title,
            createdAt: { gt: since },
          },
          select: { id: true },
        });
        shouldSend = !recent;
      }

      const settings = await prisma.notificationSettings.findFirst({
        where: { userId: owner.userId, accountId: args.accountId },
      });

      const allowInApp = settings?.inAppSignals ?? true;
      const allowEmail = settings?.billingEmails ?? true;

      const eventEnabled = isNotificationEventEnabled(settings, args.eventKey);

      if (allowInApp && eventEnabled && shouldSend) {
        await prisma.notification.create({
          data: {
            userId: owner.userId,
            accountId: args.accountId,
            title: args.title,
            body: args.body,
            tone: args.tone ?? "GOOD",
          },
        });
      }

      if (allowEmail && eventEnabled && shouldSend && owner.user?.email && args.emailSubject && args.emailHtml) {
        await sendEmail({
          to: owner.user.email,
          subject: args.emailSubject,
          html: args.emailHtml,
        }).catch(() => {});
      }
    })
  );
}

export async function POST(req: NextRequest) {
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return fail(400, "Bad body");
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return fail(400, "Missing stripe-signature header");

  let event: Stripe.Event;
  try {
    event = (await getStripe()).webhooks.constructEvent(rawBody, sig, env("STRIPE_WEBHOOK_SECRET"));
  } catch {
    return fail(400, "Webhook signature verification failed");
  }

  let accountIdHint: string | null = null;

  try {
    const obj: Stripe.Event["data"]["object"] | undefined = event.data?.object;

    // Resolve accountId best-effort early (for dedupe row)
    if (event.type.startsWith("checkout.session.")) {
      const session = obj as Stripe.Checkout.Session | null;
      accountIdHint = s(session?.metadata?.cavbot_account_id) || null;
    } else if (event.type.startsWith("customer.subscription.")) {
      const sub = obj as Stripe.Subscription | null;
      accountIdHint = s(sub?.metadata?.cavbot_account_id) || null;
    } else if (event.type.startsWith("invoice.")) {
      const invoice = obj as Stripe.Invoice | null;
      const stripeCustomerId =
        typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id || null;
      accountIdHint = (await findAccountIdByStripeCustomer(stripeCustomerId)) || null;
    }

    const dedupe = await dedupeStripeEvent(event, accountIdHint);
    if (!dedupe.firstTime) return ok({ ok: true, deduped: true });

    // -------------------------
    // checkout.session.completed
    // -------------------------
    if (event.type === "checkout.session.completed") {
      const session = obj as Stripe.Checkout.Session;

      const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;

      const accountIdFromMeta = s(session?.metadata?.cavbot_account_id) || null;
      const accountIdFromCustomer = await findAccountIdByStripeCustomer(stripeCustomerId);
      const accountId = accountIdFromMeta || accountIdFromCustomer;

      if (accountId && stripeCustomerId) {
        await prisma.account.update({ where: { id: accountId }, data: { stripeCustomerId } }).catch(() => {});
      }

      if (accountId) {
        await auditLogWrite({
          request: req,
          action: "BILLING_UPDATED",
          accountId,
          operatorUserId: null,
          targetType: "billing",
          targetId: accountId,
          targetLabel: stripeCustomerId || accountId,
          metaJson: {
            billing_event: "stripe_checkout_completed",
            stripeCustomerId,
            stripeCheckoutSessionId: s(session?.id) || null,
            payment_status: s(session?.payment_status) || null,
            mode: s(session?.mode) || null,
            stripeSubscriptionId: s(session?.subscription) || null,
          },
        });
      }

      await markProcessed(event.id, accountId || accountIdHint);
      return ok({ ok: true });
    }

    // ------------------------------------
    // customer.subscription created/updated/deleted
    // ------------------------------------
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = obj as Stripe.Subscription;

      const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;

      const metaAccountId = s(sub?.metadata?.cavbot_account_id) || null;
      const accountId = metaAccountId || (await findAccountIdByStripeCustomer(stripeCustomerId));
      if (!accountId) {
        await markProcessed(event.id, accountIdHint);
        return ok({ ok: true });
      }

      const stripeSubscriptionId = s(sub.id);

      const statusRaw = s(sub.status).toLowerCase();
      const status =
        statusRaw === "active"
          ? "ACTIVE"
          : statusRaw === "trialing"
          ? "TRIALING"
          : statusRaw === "past_due"
          ? "PAST_DUE"
          : statusRaw === "canceled" || statusRaw === "unpaid" || event.type === "customer.subscription.deleted"
          ? "CANCELED"
          : "ACTIVE";

      const firstItem = (sub.items?.data || [])[0] as Stripe.SubscriptionItem | undefined;
      const currentPeriodStart = toDateFromUnixSec(firstItem?.current_period_start);
      const currentPeriodEnd = toDateFromUnixSec(firstItem?.current_period_end);
      const priceId = firstItem?.price?.id || null;

      const mapped = priceId ? planFromPriceId(priceId) : null;
      const priorSub = await prisma.subscription.findFirst({
        where: { accountId, provider: "stripe" },
        orderBy: { createdAt: "desc" },
        select: { tier: true, billingCycle: true, status: true },
      });

      // If we can't map, at least keep the customerId stored and mark webhook done.
      if (!mapped) {
        if (stripeCustomerId) {
          await prisma.account.update({ where: { id: accountId }, data: { stripeCustomerId } }).catch(() => {});
        }
        await markProcessed(event.id, accountId);
        return ok({ ok: true });
      }

      await upsertSubscriptionFromStripe({
        request: req,
        accountId,
        stripeCustomerId,
        stripeSubscriptionId,
        priceId,
        planId: mapped.planId,
        billing: mapped.billing,
        status,
        currentPeriodStart,
        currentPeriodEnd,
      });

      const previousPlanId = resolvePlanIdFromTier(priorSub?.tier || "FREE");
      const nextPlanId: PlanId = status === "CANCELED" ? "free" : mapped.planId;
      await syncQwenPlanTransitionForAccount({
        accountId,
        oldPlan: previousPlanId,
        newPlan: nextPlanId,
        eventSource: `stripe:${event.type}`,
      });

      const nextTier = planToTier(mapped.planId);
      const prevTier = String(priorSub?.tier || "FREE").toUpperCase();

      if (status === "CANCELED") {
        await notifyOwners({
          accountId,
          title: "Subscription canceled",
          body: "Your CavBot subscription has been canceled.",
          tone: "BAD",
          eventKey: "evtSubExpired",
          emailSubject: "CavBot subscription canceled",
          emailHtml: `
            <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
              <h2 style="margin:0 0 10px;">Subscription canceled</h2>
              <p style="margin:0 0 12px;">Your CavBot subscription is now canceled. You can renew anytime.</p>
            </div>
          `,
        });
      } else if (tierRank(nextTier) > tierRank(prevTier)) {
        await notifyOwners({
          accountId,
          title: "Plan upgraded",
          body: `Your subscription was upgraded to ${nextTier}.`,
          tone: "GOOD",
          eventKey: "evtUpgraded",
          emailSubject: "Your CavBot plan was upgraded",
          emailHtml: `
            <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
              <h2 style="margin:0 0 10px;">Plan upgraded</h2>
              <p style="margin:0 0 12px;">Your subscription is now on ${nextTier}.</p>
            </div>
          `,
        });
      } else if (tierRank(nextTier) < tierRank(prevTier)) {
        await notifyOwners({
          accountId,
          title: "Plan downgraded",
          body: `Your subscription was downgraded to ${nextTier}.`,
          tone: "WATCH",
          eventKey: "evtDowngraded",
          emailSubject: "Your CavBot plan was downgraded",
          emailHtml: `
            <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
              <h2 style="margin:0 0 10px;">Plan downgraded</h2>
              <p style="margin:0 0 12px;">Your subscription is now on ${nextTier}.</p>
            </div>
          `,
        });
      }

      const tierDiff = tierRank(nextTier) - tierRank(prevTier);
      if (tierDiff !== 0 && accountId) {
        await auditLogWrite({
          request: req,
          action: tierDiff > 0 ? "PLAN_UPGRADED" : "PLAN_DOWNGRADED",
          accountId,
          operatorUserId: null,
          targetType: "billing",
          targetId: accountId,
          targetLabel: accountId,
          metaJson: {
            oldPlan: prevTier,
            newPlan: nextTier,
            billing: mapped.billing,
            stripeSubscriptionId,
            stripePlanId: mapped.planId,
          },
        });
      }

      await markProcessed(event.id, accountId);
      return ok({ ok: true });
    }

    // -------------------------
    // invoice paid / payment_failed
    // -------------------------
    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = obj as Stripe.Invoice;

      const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || null;

      const accountId = await findAccountIdByStripeCustomer(stripeCustomerId);
      if (!accountId) {
        await markProcessed(event.id, null);
        return ok({ ok: true });
      }

      const billing_event = event.type === "invoice.paid" ? "stripe_invoice_paid" : "stripe_invoice_payment_failed";
      const stripeSubscriptionId =
        typeof invoice.parent?.subscription_details?.subscription === "string"
          ? invoice.parent.subscription_details.subscription
          : invoice.parent?.subscription_details?.subscription?.id || null;

      // Enterprise logging: store everything needed to render history + download later.
      if (accountId) {
        await auditLogWrite({
          request: req,
          action: "BILLING_UPDATED",
          accountId,
          operatorUserId: null,
          targetType: "billing",
          targetId: accountId,
          targetLabel: accountId,
          metaJson: {
            billing_event,
            stripeInvoiceId: s(invoice.id) || null,
            stripeSubscriptionId: s(stripeSubscriptionId) || null,
            number: s(invoice.number) || null,
            status: s(invoice.status) || null,
            paid: s(invoice.status).toLowerCase() === "paid",
            created: typeof invoice.created === "number" ? invoice.created * 1000 : null,

            amountPaid: typeof invoice.amount_paid === "number" ? invoice.amount_paid : null,
            amountDue: typeof invoice.amount_due === "number" ? invoice.amount_due : null,
            total: typeof invoice.total === "number" ? invoice.total : null,
            currency: s(invoice.currency) || null,

            invoicePdfUrl: s(invoice.invoice_pdf) || null,
            hostedInvoiceUrl: s(invoice.hosted_invoice_url) || null,
          },
        });
      }

      if (event.type === "invoice.paid") {
        const account = await prisma.account.findUnique({
          where: { id: accountId },
          select: { tier: true },
        });
        const planId = resolvePlanIdFromTier(account?.tier || "FREE");
        await handleBillingCycleReset({
          accountId,
          planId,
        }).catch(() => {});

        await notifyOwners({
          accountId,
          title: "Payment processed",
          body: "Your subscription payment was processed successfully.",
          tone: "GOOD",
          eventKey: "evtSubRenewed",
          emailSubject: "CavBot payment processed",
          emailHtml: `
            <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
              <h2 style="margin:0 0 10px;">Payment processed</h2>
              <p style="margin:0 0 12px;">We processed your CavBot subscription payment.</p>
              <div style="margin:16px 0; padding:12px 14px; border-radius:12px; background:#0b1020; border:1px solid rgba(255,255,255,0.14);">
                <div style="font-size:12px; color:rgba(234,240,255,0.7);">Amount</div>
                <div style="font-size:20px; font-weight:800; color:#eaf0ff;">
                  ${fmtMoney(invoice.amount_paid, invoice.currency)}
                </div>
              </div>
              <p style="margin:12px 0 0; font-size:12px; color:rgba(234,240,255,0.7);">
                Thank you for building with CavBot.
              </p>
            </div>
          `,
        });
      } else {
        await notifyOwners({
          accountId,
          title: "Payment failed",
          body: "We couldn’t process your subscription payment. Please update your billing method.",
          tone: "BAD",
          eventKey: "evtSubDue",
          dedupeHours: 24,
          emailSubject: "CavBot payment failed",
          emailHtml: `
            <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
              <h2 style="margin:0 0 10px;">Payment failed</h2>
              <p style="margin:0 0 12px;">
                We couldn’t process your subscription payment. Please update your billing method to avoid interruption.
              </p>
              <div style="margin:16px 0; padding:12px 14px; border-radius:12px; background:#0b1020; border:1px solid rgba(255,255,255,0.14);">
                <div style="font-size:12px; color:rgba(234,240,255,0.7);">Amount due</div>
                <div style="font-size:20px; font-weight:800; color:#eaf0ff;">
                  ${fmtMoney(invoice.amount_due, invoice.currency)}
                </div>
              </div>
            </div>
          `,
        });
      }

      await markProcessed(event.id, accountId);
      return ok({ ok: true });
    }

    // -------------------------
    // invoice upcoming (renewal reminder)
    // -------------------------
    if (event.type === "invoice.upcoming") {
      const invoice = obj as Stripe.Invoice;
      const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || null;
      const accountId = await findAccountIdByStripeCustomer(stripeCustomerId);
      if (!accountId) {
        await markProcessed(event.id, null);
        return ok({ ok: true });
      }

      const dueSec =
        typeof invoice.next_payment_attempt === "number"
          ? invoice.next_payment_attempt
          : typeof invoice.due_date === "number"
          ? invoice.due_date
          : typeof invoice.period_end === "number"
          ? invoice.period_end
          : null;

      if (dueSec) {
        const daysUntil = Math.ceil((dueSec * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 7 && daysUntil >= 0) {
          await notifyOwners({
            accountId,
            title: "Subscription renewal due",
            body: `Your subscription renews in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
            tone: "WATCH",
            eventKey: "evtSubDue",
            emailSubject: "CavBot subscription renewal due",
            emailHtml: `
              <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
                <h2 style="margin:0 0 10px;">Renewal upcoming</h2>
                <p style="margin:0 0 12px;">Your CavBot subscription renews in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.</p>
                <div style="margin:16px 0; padding:12px 14px; border-radius:12px; background:#0b1020; border:1px solid rgba(255,255,255,0.14);">
                  <div style="font-size:12px; color:rgba(234,240,255,0.7);">Upcoming charge</div>
                  <div style="font-size:20px; font-weight:800; color:#eaf0ff;">
                    ${fmtMoney(invoice.amount_due, invoice.currency)}
                  </div>
                </div>
              </div>
            `,
          });
        }
      }

      await markProcessed(event.id, accountId);
      return ok({ ok: true });
    }

    // Default: mark processed (ignored event)
    await markProcessed(event.id, accountIdHint);
    return ok({ ok: true });
  } catch {
    // Ensure StripeEvent row isn’t left “unprocessed” forever
    await markProcessed(event.id, accountIdHint).catch(() => {});
    return fail(500, "Webhook handler failed");
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return fail(405, "METHOD_NOT_ALLOWED");
}

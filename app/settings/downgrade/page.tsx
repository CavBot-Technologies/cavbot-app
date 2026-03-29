// app/settings/downgrade/page.tsx
import "./downgrade.css";

import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import { getAppOrigin } from "@/lib/apiAuth";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { PLANS, resolvePlanIdFromTier, parseBillingCycle } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PlanId = "free" | "premium" | "premium_plus";
type BillingCycle = "monthly" | "annual";
type DowngradeTarget = "free" | "premium";

type DowngradeWorkspaceData = {
  account?: { tier?: string; billing?: { currentPeriodEnd?: string | number } };
  workspace?: { account?: { tier?: string } };
  tier?: string;
  subscription?: { currentPeriodEnd?: string | number };
  billing?: { renewalAt?: string | number };
  renewalAt?: string | number;
};

function safeStr(v: unknown) {
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v ?? "");
}

function normalizeBillingCycle(input: unknown): BillingCycle {
  const parsed = parseBillingCycle(input) as BillingCycle;
  return parsed === "annual" ? "annual" : "monthly";
}

function getPrice(planId: PlanId, billing: BillingCycle) {
  const def = PLANS?.[planId];
  const p = def?.pricing?.[billing];

  if (planId === "free") {
    return { price: "0", unit: "/ month", note: "" };
  }

  return {
    price: String(p?.price ?? "—"),
    unit: String(p?.unit ?? (billing === "annual" ? "/ year" : "/ month")),
    note: String(p?.note ?? ""),
  };
}

function planLabel(planId: PlanId) {
  if (planId === "premium_plus") return "CavElite";
  if (planId === "premium") return "CavControl";
  return "CavTower";
}

function planName(planId: PlanId) {
  if (planId === "premium_plus") return PLANS.premium_plus?.displayName ?? "CavElite";
  if (planId === "premium") return PLANS.premium?.displayName ?? "CavControl";
  return PLANS.free?.displayName ?? "CavTower";
}

/**
 * Downgrade UI accepts only "premium" or "free".
 * If someone passes "premium_plus"/"plus"/"enterprise", normalize to "premium" (one-step down),
 * NOT "free" (unintended drop).
 */
function normalizeDowngradeTargetFromQuery(raw: string): DowngradeTarget {
  const s = String(raw || "").trim().toLowerCase();

  if (
    s.includes("premium_plus") ||
    s.includes("premium+") ||
    s.includes("plus") ||
    s.includes("enterprise") ||
    s.includes("elite")
  ) {
    return "premium";
  }
  if (s.includes("premium") || s.includes("pro") || s.includes("control")) return "premium";
  if (s.includes("free") || s.includes("watch") || s.includes("tower")) return "free";

  return "free";
}

function allowedDowngradeTarget(current: PlanId, requested: DowngradeTarget): DowngradeTarget {
  if (current === "premium_plus") {
    if (requested === "premium") return "premium";
    return "free";
  }
  if (current === "premium") return "free";
  return "free";
}

function lostList(current: PlanId, target: DowngradeTarget) {
  if (current === "premium_plus" && target === "premium") {
    return [
      "CavElite scale limits reduce to CavControl capacity",
      "Maximum depth monitoring returns to CavControl depth",
      "Enterprise-level scale features are removed at renewal",
    ];
  }
  if ((current === "premium_plus" || current === "premium") && target === "free") {
    return [
      "Premium intelligence modules lock",
      "Reduced monitoring depth and workspace capacity",
      "Advanced diagnostics and deeper trend intelligence lock",
    ];
  }
  return ["No changes detected."];
}

function keepList(target: DowngradeTarget) {
  if (target === "premium") {
    return (
      PLANS.premium?.includes ?? [
        "Error Intelligence (JS + API stability)",
        "SEO Performance (indexing + structure posture)",
        "Expanded workspace capacity",
        "Proactive diagnostics + anomaly watch",
        "Multi-site monitoring across client targets",
        "Full arcade access (3 games unlocked)",
      ]
    );
  }

  return (
    PLANS.free?.includes ?? [
      "Core workspace access",
      "Basic monitoring signals",
      "Essential route visibility",
      "Limited website capacity",
    ]
  );
}

function securityLine() {
  return "Downgrades are scheduled for renewal — your current plan remains active until the next billing date.";
}

function readRenewalHint(ws: DowngradeWorkspaceData | null) {
  const raw =
    ws?.subscription?.currentPeriodEnd ||
    ws?.account?.billing?.currentPeriodEnd ||
    ws?.billing?.renewalAt ||
    ws?.renewalAt ||
    "";

  const s = String(raw || "").trim();
  if (!s) return "Effective on your next billing date.";
  try {
    const d = new Date(s);
    if (Number.isNaN(+d)) return "Effective on your next billing date.";
    return `Effective on ${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" })}.`;
  } catch {
    return "Effective on your next billing date.";
  }
}

/* ==========================
  STRIPE DOWNGRADE (OFFICIAL)
  - No fake UI
  - Schedule downgrade via /api/billing/downgrade
  - Stripe proration/renewal behavior handled by Stripe + webhook
========================== */

function getBaseUrlFromHeaders(): string {
  const h = headers();
  const fallback = new URL(getAppOrigin());
  const host = h.get("x-forwarded-host") || h.get("host") || fallback.host;
  const proto = h.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

async function startDowngradeAction(formData: FormData) {
  "use server";

  const targetPlan = String(formData.get("targetPlan") || "").trim();
  const billing = String(formData.get("billing") || "").trim();

  const h = headers();
  const cookie = h.get("cookie") || "";
  const baseUrl = getBaseUrlFromHeaders();

  const res = await fetch(`${baseUrl}/api/billing/downgrade`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      targetPlan,
      billing,
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    const msg = String(data?.message || data?.error || "Unable to schedule downgrade.");
    redirect(
      `/settings/downgrade?plan=${encodeURIComponent(targetPlan)}&billing=${encodeURIComponent(billing)}&error=${encodeURIComponent(
        msg
      )}`
    );
  }

  redirect(`/settings?tab=billing`);
}

export default async function DowngradePage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;

  let rawWs: unknown = null;
  try {
    rawWs = await readWorkspace();
  } catch {
    rawWs = null;
  }
  const ws = typeof rawWs === "object" && rawWs !== null ? (rawWs as DowngradeWorkspaceData) : null;

  const rawTier = ws?.account?.tier || ws?.workspace?.account?.tier || ws?.tier || "FREE";
  const currentPlanId = (resolvePlanIdFromTier(rawTier) as PlanId) || "free";

  const billing: BillingCycle = normalizeBillingCycle(sp?.billing);
  const isAnnual = billing === "annual";
  const billingParam = isAnnual ? "annual" : "monthly";

  const requestedTarget = normalizeDowngradeTargetFromQuery(safeStr(sp?.plan));
  const targetPlan = allowedDowngradeTarget(currentPlanId, requestedTarget);

  if (currentPlanId === "free") {
    redirect(`/plan?billing=${billingParam}`);
  }

  // Premium users cannot schedule "premium" as a downgrade target (it’s a no-op)
  if (currentPlanId === "premium" && targetPlan === "premium") {
    redirect(`/settings/downgrade?plan=free&billing=${billingParam}`);
  }

  const targetPrice = getPrice(targetPlan, billing);

  const monthlyHref = `/settings/downgrade?plan=${targetPlan}&billing=monthly`;
  const annualHref = `/settings/downgrade?plan=${targetPlan}&billing=annual`;

  const backHref = `/settings?tab=billing`;
  const viewPlansHref = `/plan?billing=${billingParam}`;

  const renewalLine = readRenewalHint(ws);

  const primaryCta = `SCHEDULE DOWNGRADE TO ${planLabel(targetPlan)}`;

  const policyLine =
    targetPlan === "premium"
      ? "Your workspace will move to CavControl at renewal. Your current plan remains active until then."
      : "Your workspace will move to CavTower at renewal. Your current plan remains active until then.";

  const priceLine =
    targetPlan === "premium"
      ? `At renewal, billing will continue as ${isAnnual ? "yearly" : "monthly"} at $${targetPrice.price}${isAnnual ? " per year" : " per month"} for CavControl.`
      : "At renewal, your paid subscription will end and the workspace will move to CavTower.";

  const cancelLine =
    "Downgrades are scheduled for renewal. No refunds or prorated credits are issued for the current billing period. You retain access through the end of your paid period.";

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="upgrade-page">
        <div className="cb-console">
          {/* HEADER */}
          <header className="upgrade-head">
            <div className="upgrade-head-left">
              <h1 className="upgrade-h1">Downgrade</h1>

              <p className="upgrade-sub">{securityLine()}</p>
              <br />
              <br />
            </div>

            <div className="upgrade-head-right">
              {/* BILLING TOGGLE */}
              <div className="upgrade-billing" role="tablist" aria-label="Billing frequency">
                <a
                  className={`upgrade-billing-btn ${!isAnnual ? "is-active" : ""}`}
                  role="tab"
                  aria-selected={!isAnnual ? "true" : "false"}
                  href={monthlyHref}
                >
                  Monthly
                </a>
                <a
                  className={`upgrade-billing-btn ${isAnnual ? "is-active" : ""}`}
                  role="tab"
                  aria-selected={isAnnual ? "true" : "false"}
                  href={annualHref}
                >
                  Yearly
                </a>
              </div>

              <br />
              <br />
              <br />
              <br />

              {/* BACK BUTTON */}
              <a className="upgrade-back" href={backHref} aria-label="Back to billing">
                <span className="upgrade-back-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path
                      d="M14.7 5.3a1 1 0 0 1 0 1.4L10.41 11l4.29 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                Back to billing
              </a>
            </div>
          </header>

          <br />
          <br />

          {/* GRID */}
          <section className="upgrade-grid" aria-label="Downgrade layout">
            {/* LEFT: TARGET PLAN SUMMARY + CTA */}
            <article className="upgrade-card upgrade-card-left" aria-label="Target plan summary">
              <div className="upgrade-card-top">
                <div className="upgrade-badge-row">
                  <div className={`upgrade-badge ${targetPlan === "premium" ? "is-premium" : "is-plus"}`}>
                    {planLabel(targetPlan === "premium" ? "premium" : "free")}
                  </div>

                  <div className="upgrade-reco-pill" aria-label="Renewal-based policy">
                    Renewal-based
                  </div>
                </div>

                <br />
                <br />

                <div className="upgrade-title">{planName(targetPlan === "premium" ? "premium" : "free")}</div>

                <div className="upgrade-desc">
                  {targetPlan === "premium"
                    ? PLANS.premium?.description ??
                      "Operational coverage with premium intelligence modules — balanced power, serious visibility."
                    : PLANS.free?.description ??
                      "Essential access to your workspace — basic signals, limited capacity, and core monitoring."}
                </div>

                <br />
                <br />

                <div className="upgrade-price">
                  <span className="upgrade-money">${targetPrice.price}</span>
                  <span className="upgrade-per">{targetPrice.unit}</span>
                </div>

                {targetPrice.note ? <div className="upgrade-note">{targetPrice.note}</div> : null}
              </div>

              <br />

              <div className="upgrade-divider" />

              <br />

              <div className="upgrade-list">
                <div className="upgrade-list-title">What remains available</div>

                <ul className="upgrade-ul">
                  {keepList(targetPlan).slice(0, 4).map((x: string) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>

                <br />

                <div className="upgrade-divider upgrade-divider-bleed" />

                <br />

                <div className="upgrade-list-title">What changes at renewal</div>

                <ul className="upgrade-ul">
                  {lostList(currentPlanId, targetPlan).slice(0, 3).map((x: string) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>

                <br />
                <br />

                <form action={startDowngradeAction}>
                  <input type="hidden" name="targetPlan" value={targetPlan} />
                  <input type="hidden" name="billing" value={billingParam} />
                  <button className="pay-submit" type="submit">
                    {primaryCta}
                  </button>
                </form>

                <div className="pay-secure" role="note" aria-label="Secure notice">
                  <span className="pay-secure-ico" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path
                        d="M12 2c-.35 0-.69.04-1.02.12L6 4.1 4.5 5.3 4 6V12c0 4.6 3.3 8.57 8 9.4 4.7-.83 8-4.8 8-9.4V6l-.5-.7-4.98-2.18A6.2 6.2 0 0 0 12 2z"
                        fill="currentColor"
                      />
                      <path
                        d="M15.6 10.8a.9.9 0 0 0-1.46-.06l-1.74 1.94-1-1.1a.9.9 0 0 0-1.32 1.23l1.66 1.85c.18.2.45.32.73.32.3 0 .58-.13.76-.34l2.42-2.7a.9.9 0 0 0 .17-.34.9.9 0 0 0-.01-.3.9.9 0 0 0-.1-.3z"
                        fill="rgba(255, 255, 255, 0.9)"
                      />
                    </svg>
                  </span>

                  <span>Downgrade scheduling is protected</span>
                </div>
              </div>
            </article>

            {/* RIGHT: POLICY (same look as upgrade) */}
            <article className="upgrade-card upgrade-card-right" aria-label="Downgrade policy">
              <div className="pay-head">
                <div>
                  <div className="pay-title">Downgrade terms</div>
                  <div className="pay-sub">A clear agreement before you continue.</div>
                </div>

                <div className="pay-total">
                  <div className="pay-total-label">Effective</div>
                  <br />
                  <br />
                  <div className="pay-total-value">
                    <b>{renewalLine}</b>
                  </div>
                </div>
              </div>

              <br />

              <div className="dd-panel" data-tone="watch" style={{ margin: "0 18px" }}>
                <span className="dd-signal" aria-hidden="true" />
                <div className="dd-panel-copy">
                  <div className="upgrade-title">Policy</div>
                  <br />
                  <p className="pay-sub">{policyLine}</p>
                </div>
              </div>

              <br />
              <br />

              <div className="pay-policy" aria-label="Downgrade terms">
                <div className="pay-policy-title">Agreement</div>
                <br />
                <p className="pay-sub">{priceLine}</p>
                <br />
                <p className="pay-sub">{cancelLine}</p>
                <br />
                <p className="pay-sub">
                  Plan capabilities update automatically at renewal. Payments, renewal timing, and subscription state are
                  enforced by Stripe and reflected in CavBot once synced.
                </p>

                <br />

                <div className="dd-secondary" style={{ padding: "0 0 18px" }}>
                  <a className="dd-ghost" href={viewPlansHref}>
                    View all plans
                  </a>
                  <a className="dd-ghost" href="/settings?tab=billing">
                    Review billing
                  </a>
                </div>
              </div>
            </article>
          </section>

          <br />
          <br />

          {/* BOTTOM STRIP */}
          <section className="upgrade-bottom" aria-label="Downgrade reassurance">
            <div className="upgrade-bottom-card">
              <div className="upgrade-bottom-title">Nothing breaks. Nothing resets.</div>
              <div className="upgrade-bottom-sub">
                Your current plan stays active until renewal. On that date, CavBot automatically switches your workspace to
                the target tier.
              </div>

              <br />
              <br />

              <div className="upgrade-bottom-row">
                <div className="upgrade-mini">
                  <div className="upgrade-mini-k">Target</div>
                  <div className="upgrade-mini-v">{planLabel(targetPlan === "premium" ? "premium" : "free")}</div>
                </div>

                <div className="upgrade-mini">
                  <div className="upgrade-mini-k">Activation</div>
                  <div className="upgrade-mini-v">On renewal</div>
                </div>

                <div className="upgrade-mini">
                  <div className="upgrade-mini-k">Refunds</div>
                  <div className="upgrade-mini-v">None</div>
                </div>
              </div>
            </div>
          </section>

          <br />
          <br />
        </div>
      </div>
    </AppShell>
  );
}

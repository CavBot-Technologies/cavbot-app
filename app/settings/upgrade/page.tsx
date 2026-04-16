// app/settings/upgrade/page.tsx
import "./upgrade.css";

import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import { beginBillingUpgrade, publicBillingError } from "@/lib/billingFlow.server";
import { buildRequestFromCurrentContext } from "@/lib/billingRequestContext.server";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { PLANS, resolvePlanIdFromTier, parseBillingCycle } from "@/lib/plans";
import { resolveBillingPlanResolution } from "@/lib/billingPlan.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PlanId = "free" | "premium" | "premium_plus";
type BillingCycle = "monthly" | "annual";

function safeStr(v: unknown) {
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

function normalizeBillingCycle(input: unknown): BillingCycle {
  const parsed = parseBillingCycle(input) as BillingCycle;
  return parsed === "annual" ? "annual" : "monthly";
}

function normalizePlanFromQuery(raw: string): PlanId {
  const s = String(raw || "").trim().toLowerCase();
  if (s.includes("premium_plus") || s.includes("premium+") || s === "plus" || s.includes("elite")) return "premium_plus";
  if (s.includes("premium") || s.includes("pro") || s.includes("control")) return "premium";
  if (s.includes("free") || s.includes("watch") || s.includes("tower")) return "free";
  return "premium";
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

function unlockTitle(planId: PlanId) {
  if (planId === "premium_plus") return "What you’ll unlock on CavElite";
  return "What you’ll unlock on CavControl";
}

function unlockList(planId: PlanId) {
  if (planId === "premium_plus") {
    return (
      PLANS.premium_plus?.includes ?? [
        "All intelligence modules unlocked",
        "Always-on diagnostics + incident posture",
        "20 websites across environments",
        "Advanced A11y audits + contrast intelligence",
        "CavBot Insights (trend intelligence + diagnostics)",
        "Maximum monitoring depth + workspace scale",
      ]
    );
  }

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

function securityLine() {
  return "Upgrading only expands capability — your workspace configuration stays intact.";
}

function readProrationHint(current: PlanId, target: PlanId, billing: BillingCycle) {
  if (current === "premium" && target === "premium_plus") {
    return billing === "annual"
      ? "Upgrade activates immediately. A prorated charge may apply today, then full CavElite billing continues at renewal."
      : "Upgrade activates immediately. A prorated difference may apply today, then full CavElite billing continues at renewal.";
  }
  if (current === "free" && (target === "premium" || target === "premium_plus")) {
    return "Upgrade activates immediately. Billing begins now and continues at the next renewal.";
  }
  return "Upgrade activates immediately.";
}

async function startCheckoutAction(formData: FormData) {
  "use server";

  const targetPlan = String(formData.get("targetPlan") || "").trim();
  const billing = String(formData.get("billing") || "").trim();

  try {
    const request = await buildRequestFromCurrentContext("/settings/upgrade", "POST");
    const result = await beginBillingUpgrade({
      request,
      targetPlan,
      billing,
    });
    redirect(String(result.url));
  } catch (error) {
    const issue = publicBillingError(error, {
      code: "CHECKOUT_FAILED",
      message: "Unable to start checkout.",
    });
    redirect(
      `/settings/upgrade?plan=${encodeURIComponent(targetPlan)}&billing=${encodeURIComponent(billing)}&error=${encodeURIComponent(issue.message)}`
    );
  }
}

export default async function UpgradeCheckoutPage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;

  let ws: unknown = null;
  try {
    ws = await readWorkspace();
  } catch {
    ws = null;
  }

  type WorkspaceData = {
    account?: { id?: string; tier?: string };
    workspace?: { account?: { id?: string; tier?: string } };
    tier?: string;
  };
  const wsObj = typeof ws === "object" && ws !== null ? (ws as WorkspaceData) : null;
  const rawTier =
    wsObj?.account?.tier ||
    wsObj?.workspace?.account?.tier ||
    wsObj?.tier ||
    "FREE";
  const workspaceAccountId = String(wsObj?.account?.id || wsObj?.workspace?.account?.id || "").trim();
  const resolvedPlan = workspaceAccountId
    ? await resolveBillingPlanResolution({
        accountId: workspaceAccountId,
        repair: true,
      })
    : null;
  const currentPlanId = resolvedPlan?.currentPlanId ?? ((resolvePlanIdFromTier(rawTier) as PlanId) || "free");

  const billing: BillingCycle = normalizeBillingCycle(sp?.billing);
  const isAnnual = billing === "annual";
  const billingParam = isAnnual ? "annual" : "monthly";
  const errorMessage = safeStr(sp?.error);

  const requestedPlan = normalizePlanFromQuery(safeStr(sp?.plan));
  const selectedPlan: PlanId = requestedPlan === "free" ? "premium" : requestedPlan;

  // Safety routing
  if (currentPlanId === "premium_plus" && selectedPlan === "premium") {
    redirect(`/settings/downgrade?plan=premium&billing=${billingParam}`);
  }
  if (currentPlanId === "premium" && requestedPlan === "free") {
    redirect(`/settings/downgrade?plan=free&billing=${billingParam}`);
  }
  if (currentPlanId === "free" && requestedPlan === "free") {
    redirect(`/plan?billing=${billingParam}`);
  }

  const selectedPrice = getPrice(selectedPlan, billing);

  const monthlyHref = `/settings/upgrade?plan=${selectedPlan}&billing=monthly`;
  const annualHref = `/settings/upgrade?plan=${selectedPlan}&billing=annual`;

  const backHref = `/plan?billing=${billingParam}`;

  const isSelectedCurrent = selectedPlan === currentPlanId;

  const isUpgradePlusFromPremium = currentPlanId === "premium" && selectedPlan === "premium_plus";

  const primaryCta = isSelectedCurrent ? `You're already on ${planLabel(selectedPlan)}` : `UNLOCK ${planLabel(selectedPlan)}`;

  const policyLine = readProrationHint(currentPlanId, selectedPlan, billing);

  const cadenceLine =
    billing === "annual"
      ? "Your subscription renews yearly unless you cancel before renewal."
      : "Your subscription renews monthly unless you cancel before renewal.";

  const priceLine =
    billing === "annual"
      ? `By continuing, you authorize CavBot to charge $${selectedPrice.price} per year for ${planLabel(selectedPlan)}.`
      : `By continuing, you authorize CavBot to charge $${selectedPrice.price} per month for ${planLabel(selectedPlan)}.`;

  const cancelLine =
    "This subscription is optional and can be canceled anytime from Billing. Canceling stops future renewals; access remains available through the remainder of your paid period.";

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="upgrade-page">
        <div className="cb-console">
          {/* HEADER */}
          <header className="upgrade-head">
            <div className="upgrade-head-left">
              <h1 className="upgrade-h1">Checkout</h1>

              <p className="upgrade-sub">{securityLine()}</p>
              {errorMessage ? <p className="upgrade-note">{errorMessage}</p> : null}
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

              {/* ENHANCED BACK BUTTON */}
              <a className="upgrade-back" href={backHref} aria-label="Back to plans">
                <span className="upgrade-back-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path
                      d="M14.7 5.3a1 1 0 0 1 0 1.4L10.41 11l4.29 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                Back to plans
              </a>
            </div>
          </header>

          <br />
          <br />

          {/* GRID */}
          <section className="upgrade-grid" aria-label="Checkout layout">
            {/* LEFT: PLAN SUMMARY + CTA ALWAYS VISIBLE */}
            <article className="upgrade-card upgrade-card-left" aria-label="Plan summary">
              <div className="upgrade-card-top">
                <div className="upgrade-badge-row">
                  {selectedPlan === "premium_plus" ? (
                    <>
                      <div className="plan-badge plan-badge-plus">{planLabel(selectedPlan)}</div>
                      <div className="plan-star-pill" aria-label="Recommended plan">
                        <span aria-hidden="true">★</span>
                      </div>
                    </>
                  ) : (
                    <div className={`upgrade-badge ${selectedPlan === "premium" ? "is-premium" : "is-plus"}`}>
                      {planLabel(selectedPlan)}
                    </div>
                  )}
                </div>

                <br />
                <br />

                <div className="upgrade-title">{planName(selectedPlan)}</div>

                <div className="upgrade-desc">
                  {selectedPlan === "premium_plus"
                    ? (PLANS.premium_plus?.description ??
                      "Maximum CavBot access — full intelligence, high-capacity scale, and elite monitoring across environments.")
                    : (PLANS.premium?.description ??
                      "Built for serious teams — deeper visibility, stronger monitoring, and premium intelligence modules.")}
                </div>

                <br />
                <br />

                <div className="upgrade-price">
                  <span className="upgrade-money">${selectedPrice.price}</span>
                  <span className="upgrade-per">{selectedPrice.unit}</span>
                </div>

                {selectedPrice.note ? <div className="upgrade-note">{selectedPrice.note}</div> : null}
              </div>

              <br />

              <div className="upgrade-divider" />

              <br />

              <div className="upgrade-list">
                <div className="upgrade-list-title">{unlockTitle(selectedPlan)}</div>

                <ul className="upgrade-ul">
                  {/* keep it tight so CTA never gets buried */}
                  {unlockList(selectedPlan)
                    .slice(0, 4)
                    .map((x: string) => (
                      <li key={x}>{x}</li>
                    ))}
                </ul>

                <br />

                <div className="upgrade-divider upgrade-divider-bleed" />

                <br />

                <div className="upgrade-footnote">
                  {selectedPlan === "premium_plus"
                    ? (PLANS.premium_plus?.footnote ??
                      "CavElite is CavBot at full scale — full intelligence, elite reliability, and high-capacity workspace limits.")
                    : (PLANS.premium?.footnote ??
                      "Premium is the operational upgrade — deeper signal, stronger coverage, real control.")}
                </div>

                <br />
                <br />

                {/* CTA: ALWAYS VISIBLE, NO CARD SCROLL */}
                {isSelectedCurrent ? (
                  <button className="pay-submit is-disabled" type="button" aria-disabled="true">
                    {primaryCta}
                  </button>
                ) : (
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="targetPlan" value={selectedPlan} />
                    <input type="hidden" name="billing" value={billingParam} />
                    <button className="pay-submit" type="submit">
                      {primaryCta}
                    </button>
                  </form>
                )}

                <div className="pay-secure" role="note" aria-label="Secure checkout">
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

                  <span>Secure checkout on Stripe</span>
                </div>
              </div>
            </article>

            {/* RIGHT: POLICY (stronger company voice) */}
            <article className="upgrade-card upgrade-card-right" aria-label="Subscription policy">
              <div className="pay-head">
                <div>
                  <div className="pay-title">Subscription terms</div>
                  <div className="pay-sub">A clear agreement before you continue.</div>
                </div>

                <div className="pay-total">
                  <div className="pay-total-label">Selected</div>
                  <br />
                  <br />
                  <br />
                  <br />
                  <div className="pay-total-value">
                    <b>{planLabel(selectedPlan)}</b> <span>{isAnnual ? "yearly" : "monthly"}</span>
                  </div>
                </div>
              </div>

              <br /><br /><br /><br />

              <div className="dd-panel" data-tone={isUpgradePlusFromPremium ? "watch" : "good"} style={{ margin: "0 18px" }}>
                <span className="dd-signal" aria-hidden="true" />
                <div className="dd-panel-copy">
                  <div className="upgrade-title">Policy</div>
                  <br />
                  <p className="pay-sub">{policyLine}</p>
                </div>
              </div>

              <br />
              <br />

              <div className="pay-policy" aria-label="Billing terms">
                <div className="pay-policy-title">Agreement</div>
                <br />
                <p className="pay-sub">{priceLine}</p>
                <br />
                <p className="pay-sub">{cadenceLine}</p>
                <br />
                <p className="pay-sub">{cancelLine}</p>
                <br />
                <p className="pay-sub">
                  Taxes, promotions, and any discount codes (if applicable) are finalized in checkout. Payments are processed by Stripe, and CavBot never stores card numbers.
                </p>
              </div>
            </article>
          </section>

          <br />
          <br />

          {/* FOOT STRIP */}
          <section className="upgrade-bottom" aria-label="Upgrade reassurance">
            <div className="upgrade-bottom-card">
              <div className="upgrade-bottom-title">No migration. No reset.</div>
              <div className="upgrade-bottom-sub">
                Your websites, routing, and workspace configuration remain exactly the same — upgrading simply unlocks deeper intelligence and higher capacity.
              </div>

              <br />
              <br />

              <div className="upgrade-bottom-row">
                <div className="upgrade-mini">
                  <div className="upgrade-mini-k">Plan selected</div>
                  <div className="upgrade-mini-v">{planLabel(selectedPlan)}</div>
                </div>

                <div className="upgrade-mini">
                  <div className="upgrade-mini-k">Billing</div>
                  <div className="upgrade-mini-v">{isAnnual ? "Yearly" : "Monthly"}</div>
                </div>

                <div className="upgrade-mini">
                  <div className="upgrade-mini-k">Activation</div>
                  <div className="upgrade-mini-v">Immediate</div>
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

import "./plan.css";

import { unstable_noStore as noStore } from "next/cache";
import type { ReactNode } from "react";

import AppShell from "@/components/AppShell";
import { LockIcon } from "@/components/LockIcon";
import { readWorkspace } from "@/lib/workspaceStore.server";
import type { WorkspacePayload } from "@/lib/workspaceStore.server";
import Image from "next/image";
import { PLANS, resolvePlanIdFromTier, parseBillingCycle } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PlanId = "free" | "premium" | "premium_plus";
type BillingCycle = "monthly" | "annual";

type ComparisonRow = {
  label: ReactNode;
  free: ReactNode;
  premium: ReactNode;
  premium_plus: ReactNode;
};

type ComparisonGroup = {
  id: string;
  title: string;
  rows: ComparisonRow[];
};

function getPrice(planId: PlanId, billing: BillingCycle) {
  const def = PLANS?.[planId];
  const p = def?.pricing?.[billing];

  if (planId === "free") {
    return { price: "0", unit: "/ Forever", note: "" };
  }

  return {
    price: String(p?.price ?? "—"),
    unit: String(p?.unit ?? (billing === "annual" ? "/ year" : "/ month")),
    note: String(p?.note ?? ""),
  };
}

function lockedCell() {
  return (
    <span className="plan-cell-lock" aria-label="Locked" title="Locked">
      <LockIcon className="plan-lock" width={14} height={14} />
    </span>
  );
}

function includedCell() {
  return (
    <span className="plan-cell-included" aria-label="Included" title="Included">
      <Image
        src="/icons/app/cavtools/check-svgrepo-com.svg"
        alt=""
        aria-hidden="true"
        width={14}
        height={14}
        className="plan-cell-check-icon"
      />
    </span>
  );
}

const QWEN_CODER_CREDITS_HELP =
  "Caven credits are consumed based on real coding usage, including context size and task complexity. Caven is powered by Qwen3-Coder.";

function qwenCreditsLabel(): ReactNode {
  return (
    <span className="plan-inline-label">
      Caven Credits
      <span className="plan-inline-help" title={QWEN_CODER_CREDITS_HELP} aria-label={QWEN_CODER_CREDITS_HELP}>
        ?
      </span>
    </span>
  );
}

function buildComparisonGroups(): ComparisonGroup[] {
  return [
    {
      id: "usage-limits",
      title: "Usage limits",
      rows: [
        {
          label: "Scans / month",
          free: "5",
          premium: "50",
          premium_plus: "500",
        },
        {
          label: "Pages / scan",
          free: "5",
          premium: "100",
          premium_plus: "1000",
        },
      ],
    },
    {
      id: "storage-workspace",
      title: "Storage & workspace capacity",
      rows: [
        {
          label: "CavCloud storage",
          free: "5 GB",
          premium: "50 GB",
          premium_plus: "500 GB",
        },
        {
          label: "CavSafe access",
          free: lockedCell(),
          premium: "Owner-only + 10 GB secured storage",
          premium_plus: (
            <span className="plan-cell-stack">
              <span>Owner-only + 50 GB secured storage</span>
              <span>Integrity lock + audit log + mountable CavSafe</span>
              <span>Time locks + snapshots + CavSafe analytics</span>
            </span>
          ),
        },
        {
          label: "Websites",
          free: "1",
          premium: "6",
          premium_plus: "20",
        },
        {
          label: "Seats included",
          free: "4",
          premium: "8",
          premium_plus: "16",
        },
      ],
    },
    {
      id: "core-features",
      title: "Core workspace features",
      rows: [
        {
          label: "Dashboard",
          free: includedCell(),
          premium: includedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "Routing",
          free: includedCell(),
          premium: includedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "Control Room",
          free: includedCell(),
          premium: includedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "Widget system",
          free: "Badge",
          premium: "Badge + Head orbit",
          premium_plus: "Badge + Head + Full body",
        },
      ],
    },
    {
      id: "diagnostics",
      title: "Diagnostics & monitoring",
      rows: [
        {
          label: "Proactive diagnostics + anomaly watch",
          free: lockedCell(),
          premium: includedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "Always-on diagnostics + incident readiness",
          free: lockedCell(),
          premium: lockedCell(),
          premium_plus: includedCell(),
        },
      ],
    },
    {
      id: "cavai",
      title: "CavAi",
      rows: [
        {
          label: "CavAi experience",
          free: "Preview lane",
          premium: "Practical day-to-day AI lane",
          premium_plus: "Full CavAi access",
        },
        {
          label: "Reasoning depth controls",
          free: "Fast-Balanced",
          premium: "Fast-Deep",
          premium_plus: "Fast-Max",
        },
        {
          label: "Models included",
          free: (
            <span className="plan-cell-stack">
              <span>DeepSeek Chat</span>
              <span>Qwen3.5-Flash</span>
              <span>Qwen3-ASR-Flash-Realtime</span>
              <span>Qwen3-TTS-Instruct-Flash-Realtime</span>
              <span>Qwen3-ASR-Flash</span>
              <span>CavBot Companion (Qwen-Plus-Character)</span>
            </span>
          ),
          premium: (
            <span className="plan-cell-stack">
              <span>DeepSeek Chat</span>
              <span>DeepSeek Reasoner</span>
              <span>Qwen3.5-Flash</span>
              <span>Qwen3.5-Plus</span>
              <span>Caven (Powered by Qwen3-Coder)</span>
              <span>Qwen3-ASR-Flash-Realtime</span>
              <span>Qwen3-TTS-Instruct-Flash-Realtime</span>
              <span>Qwen3-ASR-Flash</span>
              <span>CavBot Companion (Qwen-Plus-Character)</span>
              <span>Image Studio (Qwen-Image-2.0-Pro)</span>
            </span>
          ),
          premium_plus: (
            <span className="plan-cell-stack">
              <span>DeepSeek Chat</span>
              <span>DeepSeek Reasoner</span>
              <span>Qwen3.5-Flash</span>
              <span>Qwen3.5-Plus</span>
              <span>Qwen3-Max</span>
              <span>Caven (Powered by Qwen3-Coder)</span>
              <span>Qwen3-ASR-Flash-Realtime</span>
              <span>Qwen3-TTS-Instruct-Flash-Realtime</span>
              <span>Qwen3-ASR-Flash</span>
              <span>CavBot Companion (Qwen-Plus-Character)</span>
              <span>Image Studio (Qwen-Image-2.0-Pro)</span>
              <span>Image Edit (Qwen-Image-Edit-Max)</span>
            </span>
          ),
        },
        {
          label: qwenCreditsLabel(),
          free: "Not included on Free",
          premium: "400 credits / month (monthly credits, even on yearly billing)",
          premium_plus: (
            <span className="plan-cell-stack">
              <span>4,000 credits / month (monthly credits, even on yearly billing)</span>
              <span>Rollover up to one extra month</span>
            </span>
          ),
        },
        {
          label: "Web Research (Qwen3-Max + tools)",
          free: lockedCell(),
          premium: lockedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "Research outputs",
          free: lockedCell(),
          premium: "Standard answers",
          premium_plus: "Structured findings + sources + next actions",
        },
      ],
    },
    {
      id: "arcade",
      title: "Arcade",
      rows: [
        {
          label: "Arcade access",
          free: includedCell(),
          premium: includedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "Arcade games unlocked",
          free: "1 game",
          premium: "3 games",
          premium_plus: "All games",
        },
      ],
    },
    {
      id: "intelligence-modules",
      title: "Intelligence modules",
      rows: [
        {
          label: "Error Intelligence",
          free: lockedCell(),
          premium: includedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "Search Engine Optimization",
          free: lockedCell(),
          premium: includedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "Accessibility Intelligence",
          free: lockedCell(),
          premium: lockedCell(),
          premium_plus: includedCell(),
        },
        {
          label: "CavBot Insights",
          free: lockedCell(),
          premium: lockedCell(),
          premium_plus: includedCell(),
        },
      ],
    },
  ];
}

export default async function PlanPage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;

  let ws: WorkspacePayload | null = null;
  try {
    ws = await readWorkspace();
  } catch {
    ws = null;
  }

  const rawTier = ws?.account?.tier || ws?.workspace?.account?.tier || ws?.tier || "FREE";
  const currentPlanId = resolvePlanIdFromTier(rawTier) as PlanId;

  const billing = parseBillingCycle(sp?.billing) as BillingCycle;
  const isAnnual = billing === "annual";
  const billingParam = isAnnual ? "annual" : "monthly";

  const upgradePremiumHref = `/settings/upgrade?plan=premium&billing=${billingParam}`;
  const upgradePlusHref = `/settings/upgrade?plan=premium_plus&billing=${billingParam}`;
  const downgradePremiumHref = `/settings/downgrade?plan=premium&billing=${billingParam}`;
  const downgradeFreeHref = `/settings/downgrade?plan=free&billing=${billingParam}`;

  const premiumPrice = getPrice("premium", billing);
  const premiumPlusPrice = getPrice("premium_plus", billing);
  const comparisonGroups = buildComparisonGroups();

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="plan-page">
        <div className="cb-console">
          <header className="plan-head">
            <div className="plan-head-left">
              <h1 className="plan-h1">Start for free and upgrade anytime</h1>
              <p className="plan-sub">
                Upgrade unlocks advanced diagnostics, deeper CavAi capability, and expanded workspace capacity.
              </p>
            </div>

            <div className="plan-head-right" aria-label="Plan actions">
              <div className="plan-billing" role="tablist" aria-label="Billing frequency">
                <a
                  className={`plan-billing-btn ${!isAnnual ? "is-active" : ""}`}
                  role="tab"
                  aria-selected={!isAnnual ? "true" : "false"}
                  href="/plan?billing=monthly"
                >
                  Monthly
                </a>
                <a
                  className={`plan-billing-btn ${isAnnual ? "is-active" : ""}`}
                  role="tab"
                  aria-selected={isAnnual ? "true" : "false"}
                  href="/plan?billing=annual"
                >
                  Yearly
                </a>
              </div>
            </div>
          </header>

          <section className="plan-grid plan-grid-3" aria-label="Plans">
            <article className={`plan-card ${currentPlanId === "free" ? "is-current" : ""}`} aria-label="Free plan">
              <div className="plan-card-top">
                <div className="plan-badge">FREE TIER</div>
                <div className="plan-card-middle">
                  <div className="plan-title">{PLANS.free?.displayName ?? "CavTower"}</div>
                  <div className="plan-desc">
                    {PLANS.free?.description ??
                      "A clean entry into CavBot — command access, routing control, and one arcade experience enabled."}
                  </div>

                  <div className="plan-price">
                    <span className="plan-money">$0</span>
                    <span className="plan-per">/ Forever</span>
                  </div>
                  <span className="plan-billnote">Upgrade anytime.</span>
                </div>

                <div className="plan-cta-row">
                  {currentPlanId === "free" ? (
                    <button className="plan-btn plan-btn-muted" type="button" disabled>
                      Your current plan
                    </button>
                  ) : (
                    <a className="plan-btn plan-btn-ghost" href={downgradeFreeHref}>
                      Downgrade to CavTower
                    </a>
                  )}
                </div>
              </div>
            </article>

            <article
              className={`plan-card plan-card-premium ${currentPlanId === "premium" ? "is-current" : ""}`}
              aria-label="Premium plan"
            >
              <div className="plan-card-top">
                <div className="plan-badge plan-badge-premium">PREMIUM</div>
                <div className="plan-card-middle">
                  <div className="plan-title">{PLANS.premium?.displayName ?? "CavControl"}</div>
                  <div className="plan-desc">
                    {PLANS.premium?.description ??
                      "Built for serious teams — deeper visibility, stronger monitoring, and full arcade access across multiple websites."}
                  </div>

                  <div className="plan-price">
                    <span className="plan-money">${premiumPrice.price}</span>
                    <span className="plan-per">{premiumPrice.unit}</span>
                  </div>

                  <div className="plan-billnote">{premiumPrice.note}</div>
                </div>

                <div className="plan-cta-row">
                  {currentPlanId === "free" ? (
                    <a className="plan-btn plan-btn-lime" href={upgradePremiumHref}>
                      Upgrade to CavControl
                    </a>
                  ) : currentPlanId === "premium" ? (
                    <button className="plan-btn plan-btn-muted" type="button" disabled>
                      Your current plan
                    </button>
                  ) : (
                    <a className="plan-btn plan-btn-ghost" href={downgradePremiumHref}>
                      Downgrade to CavControl
                    </a>
                  )}
                </div>
              </div>
            </article>

            <article
              className={`plan-card plan-card-plus ${currentPlanId === "premium_plus" ? "is-current" : ""}`}
              aria-label="Premium plus plan"
            >
              <span className="plan-corner-star" aria-hidden="true">
                ★
              </span>
              <div className="plan-card-top">
                <div className="plan-badge plan-badge-plus">PREMIUM+</div>
                <div className="plan-card-middle">
                  <div className="plan-title">{PLANS.premium_plus?.displayName ?? "CavElite"}</div>
                  <div className="plan-desc">
                    {PLANS.premium_plus?.description ??
                      "Maximum CavBot access — every intelligence module, high-capacity scale, and the full reliability system across client environments."}
                  </div>

                  <div className="plan-price">
                    <span className="plan-money">${premiumPlusPrice.price}</span>
                    <span className="plan-per">{premiumPlusPrice.unit}</span>
                  </div>

                  <div className="plan-billnote">{premiumPlusPrice.note}</div>
                </div>

                <div className="plan-cta-row">
                  {currentPlanId !== "premium_plus" ? (
                    <a className="plan-btn plan-btn-violet" href={upgradePlusHref}>
                      Upgrade to CavElite
                    </a>
                  ) : (
                    <button className="plan-btn plan-btn-muted" type="button" disabled>
                      Your current plan
                    </button>
                  )}
                </div>
              </div>
            </article>
          </section>

          <section className="plan-compare-bridge" aria-label="Compare plans bridge">
            <div>
              <h2 className="plan-compare-bridge-title">Compare plans</h2>
              <p className="plan-compare-bridge-sub">
              Review exact limits, CavAi capability, Caven credits, and workspace access across CavTower,
              CavControl, and CavElite.
              </p>
            </div>
            <a className="plan-btn plan-btn-ghost plan-compare-bridge-link" href="#plan-comparison">
              Compare Plan Features
            </a>
          </section>

          <section id="plan-comparison" className="plan-compare-section" aria-label="Plan comparison matrix">
            <div className="plan-compare-wrap">
              <table className="plan-compare-table">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">
                      <span className="plan-compare-col-title">{PLANS.free?.displayName ?? "CavTower"}</span>
                    </th>
                    <th scope="col">
                      <span className="plan-compare-col-title">{PLANS.premium?.displayName ?? "CavControl"}</span>
                    </th>
                    <th scope="col">
                      <span className="plan-compare-col-title">{PLANS.premium_plus?.displayName ?? "CavElite"}</span>
                    </th>
                  </tr>
                </thead>

                {comparisonGroups.map((group) => (
                  <tbody key={group.id}>
                    <tr className="plan-compare-group-row">
                      <th colSpan={4} scope="colgroup">
                        {group.title}
                      </th>
                    </tr>
                    {group.rows.map((row, rowIndex) => (
                      <tr key={`${group.id}-${rowIndex}`}>
                        <th scope="row" className="plan-compare-feature">
                          {row.label}
                        </th>
                        <td>{row.free}</td>
                        <td>{row.premium}</td>
                        <td>{row.premium_plus}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </section>

        </div>
      </div>
    </AppShell>
  );
}

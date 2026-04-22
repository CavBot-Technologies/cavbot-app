"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AdminSignupMethodInline, AdminSignupMethodMark } from "@/components/admin/AdminSignupMethodMark";
import { AvatarBadge, EmptyState, KeyValueGrid } from "@/components/admin/AdminPrimitives";
import type { AdminSignupMethod } from "@/lib/admin/signupMethod";

export type AccountDirectoryMember = {
  id: string;
  name: string;
  handle: string;
  lastActiveLabel: string;
  avatarImage?: string | null;
  avatarTone?: string | null;
};

export type AccountDirectoryCardData = {
  id: string;
  name: string;
  email: string;
  planTier?: "FREE" | "PREMIUM" | "ENTERPRISE";
  isTrialing?: boolean;
  hasCavBotAdminIdentity?: boolean;
  signupMethod?: AdminSignupMethod;
  signupMethodLabel?: string;
  planLabel: string;
  usernameLabel: string;
  publicProfileHref?: string | null;
  healthLabel?: string | null;
  healthTone?: "good" | "watch" | "bad";
  membersLabel: string;
  sitesLabel: string;
  sessionsLabel: string;
  noticesLabel: string;
  cloudStorageLabel: string;
  safeStorageLabel: string;
  uploadedFilesLabel: string;
  deletedFilesLabel: string;
  trialLabel: string;
  subscriptionLabel: string;
  billingEmailLabel: string;
  ownerNameLabel: string;
  ownerHandleLabel: string;
  securityLabel: string;
  renewalLabel: string;
  updatedLabel: string;
  sessionCountValue?: number;
  avatarImage?: string | null;
  avatarTone?: string | null;
  detailHref?: string | null;
  helperNote?: string | null;
  memberSummaries: AccountDirectoryMember[];
};

export function AccountDirectoryGrid(props: {
  accounts: AccountDirectoryCardData[];
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const activeAccount = props.accounts.find((account) => account.id === activeId) || null;

  useEffect(() => {
    if (!activeAccount) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingHref) setActiveId(null);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeAccount, pendingHref]);

  useEffect(() => {
    if (!pendingHref) return undefined;
    const timeout = window.setTimeout(() => setPendingHref(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [pendingHref]);

  useEffect(() => {
    for (const account of props.accounts) {
      if (!account.detailHref) continue;
      router.prefetch(account.detailHref);
      router.prefetch(`${account.detailHref}/manage`);
    }
  }, [props.accounts, router]);

  useEffect(() => {
    if (!activeAccount?.detailHref) return;
    router.prefetch(activeAccount.detailHref);
    router.prefetch(`${activeAccount.detailHref}/manage`);
  }, [activeAccount, router]);

  if (!props.accounts.length) {
    return <EmptyState title="No accounts match the current filters." subtitle="Adjust the workspace search or subscription filters and try again." />;
  }

  const resolvePlanTone = (account: AccountDirectoryCardData) => {
    if (account.isTrialing) return "trialing";
    if (account.planTier === "PREMIUM") return "premium";
    if (account.planTier === "ENTERPRISE") return "enterprise";
    return "free";
  };

  const resolveNameSize = (value: string) => {
    const length = String(value || "").trim().length;
    if (length >= 24) return "xlong";
    if (length >= 18) return "long";
    return "default";
  };

  const openRoute = (href: string) => {
    setPendingHref(href);
    router.prefetch(href);
    router.push(href);
  };

  const openCard = (accountId: string) => {
    setPendingHref(null);
    setActiveId(accountId);
  };

  const routePendingLabel = pendingHref?.endsWith("/manage") ? "Opening management surface..." : "Opening full dossier...";

  const TeamMark = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" focusable="false" aria-hidden="true">
      <path
        d="M16.8 11.6c1.75 0 3.2-1.45 3.2-3.2S18.55 5.2 16.8 5.2s-3.2 1.45-3.2 3.2 1.45 3.2 3.2 3.2ZM9.8 12.2c2.55 0 4.6-2.06 4.6-4.6S12.35 3 9.8 3 5.2 5.06 5.2 7.6 7.25 12.2 9.8 12.2Zm7 1.6c-1.32 0-2.6.28-3.7.78 1.52.98 2.5 2.35 2.5 3.96v.44h4.8c.88 0 1.6-.72 1.6-1.58 0-2.45-2.75-3.6-5.2-3.6ZM9.8 14.4c-4.1 0-8 2.03-8 5.22 0 .86.72 1.58 1.6 1.58h12.8c.88 0 1.6-.72 1.6-1.58 0-3.19-3.9-5.22-8-5.22Z"
        fill="currentColor"
        opacity="0.92"
      />
    </svg>
  );

  return (
    <>
      <div className="hq-clientDirectoryGrid">
        {props.accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            className="hq-clientDirectoryCard"
            onClick={() => openCard(account.id)}
            onMouseEnter={() => {
              if (account.detailHref) {
                router.prefetch(account.detailHref);
                router.prefetch(`${account.detailHref}/manage`);
              }
            }}
            onFocus={() => {
              if (account.detailHref) {
                router.prefetch(account.detailHref);
                router.prefetch(`${account.detailHref}/manage`);
              }
            }}
            aria-haspopup="dialog"
            aria-label={`Open account card for ${account.name}${account.hasCavBotAdminIdentity ? ", CavBot admin identity" : ""}`}
          >
            {account.hasCavBotAdminIdentity ? (
              <span className="hq-clientAdminMark" aria-hidden="true">
                <TeamMark />
              </span>
            ) : null}
            <AvatarBadge
              name={account.ownerNameLabel || account.name}
              email={account.email}
              image={account.avatarImage}
              tone={account.avatarTone}
              size="lg"
            />
            <div className="hq-clientDirectoryName" data-name-size={resolveNameSize(account.name)} title={account.name}>{account.name}</div>
            <div className="hq-clientDirectoryPlan" data-plan-tone={resolvePlanTone(account)}>{account.planLabel}</div>
            <div className="hq-clientDirectoryHandle">{account.usernameLabel}</div>
            {account.signupMethod ? (
              <span className="hq-clientSignupMark" aria-hidden="true">
                <span className="hq-signupMethodMark" data-method={account.signupMethod}>
                  <AdminSignupMethodMark method={account.signupMethod} size={14} />
                </span>
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {activeAccount ? (
        <div className="hq-clientModalRoot" role="dialog" aria-modal="true" aria-labelledby={`account-modal-title-${activeAccount.id}`}>
          <button
            type="button"
            className="hq-clientModalBackdrop"
            aria-label="Close account card"
            onClick={() => {
              if (!pendingHref) {
                setPendingHref(null);
                setActiveId(null);
              }
            }}
          />
          <div className="hq-clientModalPanel" data-route-pending={pendingHref ? "true" : "false"} aria-busy={pendingHref ? "true" : undefined}>
            <div className="hq-clientModalTopbar">
              <div className="hq-clientModalHero">
                <AvatarBadge
                  name={activeAccount.ownerNameLabel || activeAccount.name}
                  email={activeAccount.email}
                  image={activeAccount.avatarImage}
                  tone={activeAccount.avatarTone}
                  size="lg"
                />
                <div className="hq-clientModalIdentity">
                  <div className="hq-clientModalTitleRow">
                    <h3 id={`account-modal-title-${activeAccount.id}`} className="hq-clientModalTitle">{activeAccount.name}</h3>
                  </div>
                  <p className="hq-clientModalSub" data-plan-tone={resolvePlanTone(activeAccount)}>{activeAccount.planLabel}</p>
                  <p className="hq-clientModalEmail">{activeAccount.email}</p>
                  {activeAccount.publicProfileHref || activeAccount.detailHref ? (
                    <div className="hq-clientModalActions">
                      {activeAccount.publicProfileHref ? (
                        <Link href={activeAccount.publicProfileHref} className="hq-button" onClick={() => setActiveId(null)}>
                          View profile
                        </Link>
                      ) : null}
                      {activeAccount.detailHref ? (
                        <button
                          type="button"
                          className="hq-buttonGhost"
                          disabled={Boolean(pendingHref)}
                          onClick={() => openRoute(activeAccount.detailHref!)}
                        >
                          Full dossier
                        </button>
                      ) : null}
                      {activeAccount.detailHref ? (
                        <button
                          type="button"
                          className="hq-buttonGhost"
                          disabled={Boolean(pendingHref)}
                          onClick={() => openRoute(`${activeAccount.detailHref!}/manage`)}
                        >
                          Manage
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="hq-helperText">{activeAccount.helperNote || "Account detail is unavailable for this record."}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="hq-clientModalClose"
                onClick={() => {
                  if (!pendingHref) {
                    setPendingHref(null);
                    setActiveId(null);
                  }
                }}
                aria-label="Close account card"
                disabled={Boolean(pendingHref)}
              >
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            {pendingHref ? (
              <div className="hq-clientModalRouteState" role="status" aria-live="polite">
                {routePendingLabel}
              </div>
            ) : null}

            <div className="hq-clientModalStats">
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Members</div>
                <div className="hq-clientStatValue">{activeAccount.membersLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Sites</div>
                <div className="hq-clientStatValue">{activeAccount.sitesLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Sessions</div>
                <div className="hq-clientStatValue">{activeAccount.sessionsLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Open notices</div>
                <div className="hq-clientStatValue">{activeAccount.noticesLabel}</div>
              </article>
            </div>

            <KeyValueGrid
              items={[
                {
                  label: "Plan",
                  value: <span className="hq-planValue" data-plan-tone={resolvePlanTone(activeAccount)}>{activeAccount.planLabel}</span>,
                },
                { label: "Health", value: activeAccount.healthLabel || "Watching" },
                { label: "Subscription", value: activeAccount.subscriptionLabel },
                { label: "Trial", value: activeAccount.trialLabel },
                activeAccount.signupMethod
                  ? {
                      label: "Signup method",
                      value: <AdminSignupMethodInline method={activeAccount.signupMethod} label={activeAccount.signupMethodLabel} />,
                    }
                  : { label: "Signup method", value: "CavBot" },
                { label: "Owner", value: activeAccount.ownerNameLabel },
                { label: "Owner handle", value: activeAccount.ownerHandleLabel },
                { label: "Billing email", value: activeAccount.billingEmailLabel },
                { label: "CavCloud storage", value: activeAccount.cloudStorageLabel },
                { label: "CavSafe storage", value: activeAccount.safeStorageLabel },
                { label: "Uploaded files", value: activeAccount.uploadedFilesLabel },
                { label: "Deleted files", value: activeAccount.deletedFilesLabel },
                { label: "Security", value: activeAccount.securityLabel },
                { label: "Renewal", value: activeAccount.renewalLabel },
                { label: "Updated", value: activeAccount.updatedLabel },
              ]}
            />

            {activeAccount.memberSummaries.length ? (
              <section className="hq-clientWorkspaceSection">
                <div className="hq-clientWorkspaceHead">
                  <h4 className="hq-clientWorkspaceTitle">Member roster</h4>
                  <p className="hq-clientWorkspaceSub">Owner, admins, and members attached to this workspace right now.</p>
                </div>
                <div className="hq-clientRosterGrid">
                  {activeAccount.memberSummaries.map((member) => (
                    <article key={member.id} className="hq-clientRosterCard">
                      <div className="hq-inlineStart">
                        <AvatarBadge
                          name={member.name}
                          email={member.handle}
                          image={member.avatarImage}
                          tone={member.avatarTone}
                          size="sm"
                        />
                        <div>
                          <div className="hq-clientRosterName">{member.name}</div>
                          <div className="hq-clientRosterHandle">{member.handle}</div>
                        </div>
                      </div>
                      <p className="hq-clientRosterMeta">{member.lastActiveLabel}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AvatarBadge, Badge, EmptyState, KeyValueGrid } from "@/components/admin/AdminPrimitives";

export type ClientDirectoryWorkspace = {
  id: string;
  name: string;
  ownerLabel: string;
  roleLabel: string;
  planLabel: string;
  statusLabel: string;
  trialLabel: string;
};

export type ClientDirectoryCardData = {
  id: string;
  name: string;
  email: string;
  planTier?: "FREE" | "PREMIUM" | "ENTERPRISE";
  isTrialing?: boolean;
  hasCavBotAdminIdentity?: boolean;
  planLabel: string;
  usernameLabel: string;
  regionLabel: string;
  joinedLabel: string;
  lastActiveLabel: string;
  trialLabel: string;
  sitesLabel: string;
  sessionsLabel: string;
  cavverifyLabel: string;
  cavguardLabel: string;
  cloudStorageLabel: string;
  safeStorageLabel: string;
  uploadedFilesLabel: string;
  deletedFilesLabel: string;
  workspaceCountLabel: string;
  primaryOwnerLabel: string;
  primaryWorkspaceLabel: string;
  healthLabel?: string | null;
  healthTone?: "good" | "watch" | "bad";
  sessionCountValue?: number;
  avatarImage?: string | null;
  avatarTone?: string | null;
  publicProfileHref?: string | null;
  detailHref?: string | null;
  isPreview?: boolean;
  previewNote?: string | null;
  workspaceSummaries: ClientDirectoryWorkspace[];
};

export function ClientDirectoryGrid(props: {
  clients: ClientDirectoryCardData[];
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const activeClient = props.clients.find((client) => client.id === activeId) || null;

  useEffect(() => {
    if (!activeClient) return undefined;

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
  }, [activeClient, pendingHref]);

  useEffect(() => {
    if (!pendingHref) return undefined;
    const timeout = window.setTimeout(() => setPendingHref(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [pendingHref]);

  if (!props.clients.length) {
    return <EmptyState title="No clients match the current filters." subtitle="Adjust the query, plan, activity, or region filters and try again." />;
  }

  const resolvePlanTone = (client: ClientDirectoryCardData) => {
    if (client.isTrialing) return "trialing";
    if (client.planTier === "PREMIUM") return "premium";
    if (client.planTier === "ENTERPRISE") return "enterprise";
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
    router.push(href);
  };

  const openCard = (clientId: string) => {
    setPendingHref(null);
    setActiveId(clientId);
  };

  const routePendingLabel = pendingHref?.endsWith("/manage") ? "Opening management surface..." : "Opening full dossier...";

  return (
    <>
      <div className="hq-clientDirectoryGrid">
        {props.clients.map((client) => (
          <button
            key={client.id}
            type="button"
            className="hq-clientDirectoryCard"
            onClick={() => openCard(client.id)}
            aria-haspopup="dialog"
            aria-label={`Open client card for ${client.name}${client.hasCavBotAdminIdentity ? ", CavBot admin identity" : ""}`}
          >
            {client.hasCavBotAdminIdentity ? (
              <span className="hq-clientAdminMark" aria-hidden="true">
                <Image src="/logo/cavbot-logomark.svg" alt="" width={14} height={14} />
              </span>
            ) : null}
            {client.isPreview ? <span className="hq-clientPreviewChip">Preview</span> : null}
            <AvatarBadge
              name={client.name}
              email={client.email}
              image={client.avatarImage}
              tone={client.avatarTone}
              size="lg"
            />
            <div className="hq-clientDirectoryName" data-name-size={resolveNameSize(client.name)} title={client.name}>{client.name}</div>
            <div className="hq-clientDirectoryPlan" data-plan-tone={resolvePlanTone(client)}>{client.planLabel}</div>
            <div className="hq-clientDirectoryHandle">{client.usernameLabel}</div>
          </button>
        ))}
      </div>

      {activeClient ? (
        <div className="hq-clientModalRoot" role="dialog" aria-modal="true" aria-labelledby={`client-modal-title-${activeClient.id}`}>
          <button
            type="button"
            className="hq-clientModalBackdrop"
            aria-label="Close client card"
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
                  name={activeClient.name}
                  email={activeClient.email}
                  image={activeClient.avatarImage}
                  tone={activeClient.avatarTone}
                  size="lg"
                />
                <div className="hq-clientModalIdentity">
                  <div className="hq-clientModalTitleRow">
                    <h3 id={`client-modal-title-${activeClient.id}`} className="hq-clientModalTitle">{activeClient.name}</h3>
                    {activeClient.isPreview ? <Badge className="hq-clientModalPreviewBadge">Preview</Badge> : null}
                  </div>
                  <p className="hq-clientModalSub" data-plan-tone={resolvePlanTone(activeClient)}>{activeClient.planLabel}</p>
                  <p className="hq-clientModalEmail">{activeClient.email}</p>
                  {activeClient.publicProfileHref || activeClient.detailHref ? (
                    <div className="hq-clientModalActions">
                      {activeClient.publicProfileHref ? (
                        <Link href={activeClient.publicProfileHref} className="hq-button" onClick={() => setActiveId(null)}>
                          View profile
                        </Link>
                      ) : null}
                      {activeClient.detailHref ? (
                        <button
                          type="button"
                          className="hq-buttonGhost"
                          disabled={Boolean(pendingHref)}
                          onClick={() => openRoute(activeClient.detailHref!)}
                        >
                          Full dossier
                        </button>
                      ) : null}
                      {activeClient.detailHref ? (
                        <button
                          type="button"
                          className="hq-buttonGhost"
                          disabled={Boolean(pendingHref)}
                          onClick={() => openRoute(`${activeClient.detailHref!}/manage`)}
                        >
                          Manage
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="hq-helperText">{activeClient.previewNote || "Client detail is unavailable for this record."}</p>
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
                aria-label="Close client card"
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
                <div className="hq-clientStatLabel">Sites</div>
                <div className="hq-clientStatValue">{activeClient.sitesLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Sessions</div>
                <div className="hq-clientStatValue">{activeClient.sessionsLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Caverify</div>
                <div className="hq-clientStatValue">{activeClient.cavverifyLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">CavGuard</div>
                <div className="hq-clientStatValue">{activeClient.cavguardLabel}</div>
              </article>
            </div>

            <KeyValueGrid
              items={[
                {
                  label: "Plan",
                  value: <span className="hq-planValue" data-plan-tone={resolvePlanTone(activeClient)}>{activeClient.planLabel}</span>,
                },
                { label: "Health", value: activeClient.healthLabel || "Watching" },
                { label: "Username", value: activeClient.usernameLabel },
                { label: "Region", value: activeClient.regionLabel },
                { label: "Joined", value: activeClient.joinedLabel },
                { label: "Last active", value: activeClient.lastActiveLabel },
                { label: "Trial", value: activeClient.trialLabel },
                { label: "CavCloud storage", value: activeClient.cloudStorageLabel },
                { label: "CavSafe storage", value: activeClient.safeStorageLabel },
                { label: "Uploaded files", value: activeClient.uploadedFilesLabel },
                { label: "Deleted files", value: activeClient.deletedFilesLabel },
                { label: "Workspaces", value: activeClient.workspaceCountLabel },
                { label: "Primary workspace", value: activeClient.primaryWorkspaceLabel },
                { label: "Primary owner", value: activeClient.primaryOwnerLabel },
              ]}
            />

            {activeClient.workspaceSummaries.length ? (
              <section className="hq-clientWorkspaceSection">
                <div className="hq-clientWorkspaceHead">
                  <h4 className="hq-clientWorkspaceTitle">Workspace coverage</h4>
                  <p className="hq-clientWorkspaceSub">Operational ownership, plan status, and trial timing for this client’s attached workspaces.</p>
                </div>
                <div className="hq-clientWorkspaceGrid">
                  {activeClient.workspaceSummaries.map((workspace) => (
                    <article key={workspace.id} className="hq-clientWorkspaceCard">
                      <div className="hq-clientWorkspaceRow">
                        <strong className="hq-clientWorkspaceName">{workspace.name}</strong>
                        <span
                          className="hq-clientWorkspaceStatus"
                          data-status={workspace.statusLabel.toLowerCase().replace(/\s+/g, "-")}
                        >
                          {workspace.statusLabel}
                        </span>
                      </div>
                      <p className="hq-clientWorkspaceMeta">{workspace.ownerLabel} · {workspace.roleLabel} · {workspace.planLabel}</p>
                      <p className="hq-clientWorkspaceTrial">{workspace.trialLabel}</p>
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

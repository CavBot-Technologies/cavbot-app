"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AvatarBadge, EmptyState, KeyValueGrid } from "@/components/admin/AdminPrimitives";

export type AiAgentAccountCardData = {
  accountId: string;
  accountName: string;
  accountHandle: string;
  planLabel: string;
  ownerName: string;
  ownerHandle: string;
  creatorName: string;
  creatorHandle: string;
  creatorEmail: string;
  avatarImage?: string | null;
  avatarTone?: string | null;
  publicProfileHref?: string | null;
  clientDetailHref?: string | null;
  accountDetailHref?: string | null;
  createdAgentsLabel: string;
  tokensLabel: string;
  cavaiUsageLabel: string;
  cavenUsageLabel: string;
  disciplineStatusLabel: string;
  disciplineTone: "good" | "watch" | "bad";
  violationCountLabel: string;
  updatedLabel: string;
  manageable: boolean;
  helperNote?: string | null;
};

export type AiAgentDirectoryRow = {
  id: string;
  kind: "created" | "cavbot";
  isPreview?: boolean;
  name: string;
  summary: string;
  iconSvg?: string | null;
  iconSrc?: string | null;
  iconBackground?: string | null;
  agentIdValue?: string | null;
  actionKey: string;
  surface: "cavcode" | "center" | "all";
  surfaceLabel: string;
  createdAtLabel: string;
  createdAtISO: string;
  usageCountLabel: string;
  cavaiUsageLabel: string;
  cavenUsageLabel: string;
  creationSourceLabel: string;
  creationPromptLabel: string;
  instructions: string;
  triggers: string[];
  publicationLabel: string;
  publicationRequested: boolean;
  isPublished: boolean;
  creatorHandleLabel: string;
  creatorNameLabel: string;
  creatorUserId?: string | null;
  accountNameLabel: string;
  accountId?: string | null;
  account: AiAgentAccountCardData | null;
  helperNote?: string | null;
};

type ConfirmAction =
  | { type: "publish"; rowId: string }
  | { type: "unpublish"; rowId: string }
  | { type: "delete"; rowId: string }
  | { type: "suspend"; rowId: string; days: 7 | 14 | 30 }
  | { type: "revoke"; rowId: string }
  | null;

function AgentIcon(props: {
  iconSvg?: string | null;
  iconSrc?: string | null;
  background?: string | null;
  agentId?: string | null;
  alt: string;
}) {
  return (
    <span
      className="hq-aiAgentIcon"
      data-agent-id={props.agentId || undefined}
      style={props.background ? { background: props.background } : undefined}
      aria-hidden="true"
    >
      {props.iconSvg ? (
        <span
          className="hq-aiAgentIconArt"
          dangerouslySetInnerHTML={{ __html: props.iconSvg }}
        />
      ) : props.iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={props.iconSrc} alt="" className="hq-aiAgentIconImg" />
      ) : (
        <span className="hq-aiAgentIconFallback">{props.alt.slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}

function disciplineMessage(action: ConfirmAction) {
  if (!action) return "";
  if (action.type === "publish") return "Publish this agent to every eligible operator surface?";
  if (action.type === "unpublish") return "Remove this agent from the shared CavCode catalog for other operators?";
  if (action.type === "delete") return "Delete this created agent from the workspace and remove it from HQ moderation queues?";
  if (action.type === "revoke") return "Revoke this account after repeated violations?";
  return `Suspend this account for ${action.days} days? A third violation auto-revokes the account.`;
}

function PublishedCheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="hq-aiAgentPublishedIcon">
      <path
        d="M3.5 8.3 6.6 11.4 12.6 5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AiAgentsDirectory(props: {
  rows: AiAgentDirectoryRow[];
}) {
  const router = useRouter();
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const activeRow = props.rows.find((row) => row.id === activeRowId) || null;
  const activeAccount = useMemo(() => {
    if (!activeAccountId) return null;
    return props.rows.find((row) => row.account?.accountId === activeAccountId)?.account || null;
  }, [activeAccountId, props.rows]);

  const isManagedCreatedRow = (row: AiAgentDirectoryRow | null | undefined) =>
    Boolean(row && row.kind === "created" && row.accountId && row.creatorUserId && !row.isPreview);

  useEffect(() => {
    if (!activeRow && !activeAccount && !confirmAction) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmAction) {
        setConfirmAction(null);
        return;
      }
      if (activeAccount) {
        setActiveAccountId(null);
        return;
      }
      setActiveRowId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeAccount, activeRow, confirmAction]);

  const runPublish = async (row: AiAgentDirectoryRow) => {
    if (!isManagedCreatedRow(row)) return;
    setBusyKey(row.id);
    setMessage("");
    try {
      const res = await fetch("/api/admin/ai-agents/publish", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          accountId: row.accountId,
          userId: row.creatorUserId,
          agentId: row.agentIdValue || "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMessage("Publishing the agent did not complete.");
        return;
      }
      setConfirmAction(null);
      setMessage(`${row.name} is now published.`);
      router.refresh();
    } catch {
      setMessage("Publishing the agent did not complete.");
    } finally {
      setBusyKey("");
    }
  };

  const runUnpublish = async (row: AiAgentDirectoryRow) => {
    if (!isManagedCreatedRow(row)) return;
    setBusyKey(row.id);
    setMessage("");
    try {
      const res = await fetch("/api/admin/ai-agents/unpublish", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          accountId: row.accountId,
          userId: row.creatorUserId,
          agentId: row.agentIdValue || "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMessage("Unpublishing the agent did not complete.");
        return;
      }
      setConfirmAction(null);
      setMessage(`${row.name} is now unpublished.`);
      router.refresh();
    } catch {
      setMessage("Unpublishing the agent did not complete.");
    } finally {
      setBusyKey("");
    }
  };

  const runDelete = async (row: AiAgentDirectoryRow) => {
    if (!isManagedCreatedRow(row)) return;
    setBusyKey(row.id);
    setMessage("");
    try {
      const res = await fetch("/api/admin/ai-agents/delete", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          accountId: row.accountId,
          userId: row.creatorUserId,
          agentId: row.agentIdValue || "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMessage("Deleting the agent did not complete.");
        return;
      }
      setConfirmAction(null);
      setActiveRowId(null);
      setMessage(`${row.name} was deleted.`);
      router.refresh();
    } catch {
      setMessage("Deleting the agent did not complete.");
    } finally {
      setBusyKey("");
    }
  };

  const runAccountAction = async (
    account: AiAgentAccountCardData,
    action: "suspend" | "revoke",
    durationDays?: 7 | 14 | 30,
  ) => {
    setBusyKey(account.accountId);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/accounts/${account.accountId}/discipline`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action,
          durationDays,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; escalatedToRevoke?: boolean };
      if (!res.ok || !data.ok) {
        setMessage("The account action did not complete.");
        return;
      }
      setConfirmAction(null);
      setMessage(
        action === "revoke"
          ? `${account.accountName} has been revoked.`
          : data.escalatedToRevoke
            ? `${account.accountName} hit the violation limit and was revoked.`
            : `${account.accountName} has been suspended for ${durationDays} days.`,
      );
      router.refresh();
    } catch {
      setMessage("The account action did not complete.");
    } finally {
      setBusyKey("");
    }
  };

  if (!props.rows.length) {
    return (
      <EmptyState
        title="No agents match these filters."
        subtitle="Adjust the catalog, surface, account, or search filters to widen the agent intelligence view."
      />
    );
  }

  return (
    <>
      {message ? <p className="hq-helperText hq-aiAgentsMessage">{message}</p> : null}
      <div className="hq-aiAgentGrid">
        {props.rows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="hq-aiAgentCard"
            onClick={() => {
              setMessage("");
              setActiveRowId(row.id);
            }}
            aria-haspopup="dialog"
            aria-label={`Open agent record for ${row.name}`}
          >
            {row.isPublished ? (
              <span className="hq-aiAgentPublishedMark" aria-hidden="true">
                <PublishedCheckIcon />
              </span>
            ) : null}
            <div className="hq-aiAgentCardTop">
              <AgentIcon
                iconSvg={row.iconSvg}
                iconSrc={row.iconSrc}
                background={row.iconBackground}
                agentId={row.agentIdValue || row.id}
                alt={row.name}
              />
              <div className="hq-aiAgentCardMeta">
                <div className="hq-aiAgentNameRow">
                  <strong className="hq-aiAgentName">{row.name}</strong>
                </div>
                <div className="hq-aiAgentHandle">{row.creatorHandleLabel}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {activeRow ? (
        <div className="hq-clientModalRoot" role="dialog" aria-modal="true" aria-labelledby={`agent-modal-title-${activeRow.id}`}>
          <button
            type="button"
            className="hq-clientModalBackdrop"
            aria-label="Close agent record"
            onClick={() => setActiveRowId(null)}
          />
          <div className="hq-clientModalPanel">
            <div className="hq-clientModalTopbar">
              <div className="hq-clientModalHero">
                <AgentIcon
                  iconSvg={activeRow.iconSvg}
                  iconSrc={activeRow.iconSrc}
                  background={activeRow.iconBackground}
                  agentId={activeRow.agentIdValue || activeRow.id}
                  alt={activeRow.name}
                />
                <div className="hq-clientModalIdentity">
                  <div className="hq-clientModalTitleRow">
                    <h3 id={`agent-modal-title-${activeRow.id}`} className="hq-clientModalTitle">{activeRow.name}</h3>
                  </div>
                  <p className="hq-aiAgentModalSummary">{activeRow.summary}</p>
                  <p className="hq-clientModalSub">{activeRow.surfaceLabel} · {activeRow.creationSourceLabel}</p>
                  <p className="hq-clientModalEmail">{activeRow.accountNameLabel}</p>
                  <div className="hq-clientModalActions">
                    {activeRow.account ? (
                      <button
                        type="button"
                        className="hq-buttonGhost"
                        onClick={() => {
                          setActiveRowId(null);
                          setActiveAccountId(activeRow.account?.accountId || null);
                        }}
                      >
                        View profile
                      </button>
                    ) : null}
                    {activeRow.kind === "created" ? (
                      <button
                        type="button"
                        className={activeRow.isPublished ? "hq-buttonGhost" : "hq-button"}
                        disabled={busyKey === activeRow.id || !isManagedCreatedRow(activeRow)}
                        onClick={() => setConfirmAction({ type: activeRow.isPublished ? "unpublish" : "publish", rowId: activeRow.id })}
                      >
                        {activeRow.isPublished ? "Unpublish" : "Publish"}
                      </button>
                    ) : null}
                    {activeRow.kind === "created" ? (
                      <button
                        type="button"
                        className="hq-buttonGhost"
                        data-tone="danger"
                        disabled={busyKey === activeRow.id || !isManagedCreatedRow(activeRow)}
                        onClick={() => setConfirmAction({ type: "delete", rowId: activeRow.id })}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <button type="button" className="hq-clientModalClose" onClick={() => setActiveRowId(null)} aria-label="Close agent record">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="hq-clientModalStats">
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Usage</div>
                <div className="hq-clientStatValue">{activeRow.usageCountLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">CavAi</div>
                <div className="hq-clientStatValue">{activeRow.cavaiUsageLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Caven</div>
                <div className="hq-clientStatValue">{activeRow.cavenUsageLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Status</div>
                <div className="hq-clientStatValue">{activeRow.publicationLabel}</div>
              </article>
            </div>

            <KeyValueGrid
              items={[
                { label: "Surface", value: activeRow.surfaceLabel },
                { label: "Created", value: activeRow.createdAtLabel },
                { label: "Action key", value: activeRow.actionKey },
                { label: "Creator", value: activeRow.creatorNameLabel },
                { label: "Creator handle", value: activeRow.creatorHandleLabel },
                { label: "Workspace", value: activeRow.accountNameLabel },
              ]}
            />

            <section className="hq-aiAgentSection">
              <div className="hq-clientWorkspaceHead">
                <h4 className="hq-clientWorkspaceTitle">Instructions</h4>
                <p className="hq-clientWorkspaceSub">Exact instructions currently saved on the agent.</p>
              </div>
              <pre className="hq-aiAgentCodeBlock">{activeRow.instructions}</pre>
            </section>

            <section className="hq-aiAgentSection">
              <div className="hq-clientWorkspaceHead">
                <h4 className="hq-clientWorkspaceTitle">Triggers</h4>
                <p className="hq-clientWorkspaceSub">Phrases CavBot uses to route into this agent.</p>
              </div>
              <div className="hq-aiAgentTriggerRow">
                {activeRow.triggers.length ? activeRow.triggers.map((trigger) => (
                  <span key={trigger} className="hq-aiAgentPill">{trigger}</span>
                )) : <span className="hq-helperText">{activeRow.helperNote || "No trigger phrases were saved."}</span>}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {activeAccount ? (
        <div className="hq-clientModalRoot" role="dialog" aria-modal="true" aria-labelledby={`agent-account-modal-${activeAccount.accountId}`}>
          <button
            type="button"
            className="hq-clientModalBackdrop"
            aria-label="Close creator account"
            onClick={() => setActiveAccountId(null)}
          />
          <div className="hq-clientModalPanel">
            <div className="hq-clientModalTopbar">
              <div className="hq-clientModalHero">
                <AvatarBadge
                  name={activeAccount.creatorName}
                  email={activeAccount.creatorEmail}
                  image={activeAccount.avatarImage}
                  tone={activeAccount.avatarTone}
                  size="lg"
                />
                <div className="hq-clientModalIdentity">
                  <div className="hq-clientModalTitleRow">
                    <h3 id={`agent-account-modal-${activeAccount.accountId}`} className="hq-clientModalTitle">{activeAccount.accountName}</h3>
                  </div>
                  <p className="hq-clientModalSub">{activeAccount.planLabel}</p>
                  <p className="hq-clientModalEmail">{activeAccount.creatorEmail}</p>
                  <div className="hq-clientModalActions">
                    {activeAccount.publicProfileHref ? (
                      <Link href={activeAccount.publicProfileHref} className="hq-button" onClick={() => setActiveAccountId(null)}>
                        View profile
                      </Link>
                    ) : null}
                    {activeAccount.accountDetailHref ? (
                      <Link href={activeAccount.accountDetailHref} className="hq-buttonGhost" onClick={() => setActiveAccountId(null)}>
                        Account dossier
                      </Link>
                    ) : null}
                    {activeAccount.clientDetailHref ? (
                      <Link href={activeAccount.clientDetailHref} className="hq-buttonGhost" onClick={() => setActiveAccountId(null)}>
                        Client dossier
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
              <button type="button" className="hq-clientModalClose" onClick={() => setActiveAccountId(null)} aria-label="Close creator account">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="hq-clientModalStats">
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Created agents</div>
                <div className="hq-clientStatValue">{activeAccount.createdAgentsLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Monthly tokens</div>
                <div className="hq-clientStatValue">{activeAccount.tokensLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">CavAi usage</div>
                <div className="hq-clientStatValue">{activeAccount.cavaiUsageLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Caven usage</div>
                <div className="hq-clientStatValue">{activeAccount.cavenUsageLabel}</div>
              </article>
            </div>

            <KeyValueGrid
              items={[
                { label: "Creator", value: activeAccount.creatorName },
                { label: "Creator handle", value: activeAccount.creatorHandle },
                { label: "Owner", value: activeAccount.ownerName },
                { label: "Owner handle", value: activeAccount.ownerHandle },
                { label: "Workspace", value: activeAccount.accountHandle },
                { label: "Discipline", value: activeAccount.disciplineStatusLabel },
                { label: "Violations", value: activeAccount.violationCountLabel },
                { label: "Updated", value: activeAccount.updatedLabel },
              ]}
            />

            {activeAccount.manageable ? (
              <section className="hq-aiAgentSection">
                <div className="hq-clientWorkspaceHead">
                  <h4 className="hq-clientWorkspaceTitle">Manage account</h4>
                  <p className="hq-clientWorkspaceSub">Suspend for 7, 14, or 30 days. The third violation revokes the account.</p>
                </div>
                <div className="hq-aiAgentActionRow">
                  {[7, 14, 30].map((days) => (
                    <button
                      key={days}
                      type="button"
                      className="hq-buttonGhost"
                      disabled={busyKey === activeAccount.accountId}
                      onClick={() => setConfirmAction({ type: "suspend", rowId: activeAccount.accountId, days: days as 7 | 14 | 30 })}
                    >
                      Suspend {days}d
                    </button>
                  ))}
                  <button
                    type="button"
                    className="hq-button"
                    disabled={busyKey === activeAccount.accountId}
                    onClick={() => setConfirmAction({ type: "revoke", rowId: activeAccount.accountId })}
                  >
                    Revoke
                  </button>
                </div>
              </section>
            ) : activeAccount.helperNote ? (
              <p className="hq-helperText">{activeAccount.helperNote}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="hq-clientModalRoot" role="dialog" aria-modal="true" aria-labelledby="ai-agent-confirm-title">
          <button
            type="button"
            className="hq-clientModalBackdrop"
            aria-label="Close confirmation"
            onClick={() => setConfirmAction(null)}
          />
          <div className="hq-clientModalPanel hq-aiAgentConfirmPanel">
            <div className="hq-clientModalTopbar">
              <div className="hq-clientModalIdentity">
                <h3 id="ai-agent-confirm-title" className="hq-clientModalTitle">Confirm action</h3>
                <p className="hq-clientModalEmail">{disciplineMessage(confirmAction)}</p>
              </div>
              <button type="button" className="hq-clientModalClose" onClick={() => setConfirmAction(null)} aria-label="Close confirmation">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>
            <div className="hq-aiAgentActionRow">
              <button type="button" className="hq-buttonGhost" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={confirmAction.type === "delete" || confirmAction.type === "revoke" ? "hq-buttonGhost" : "hq-button"}
                data-tone={confirmAction.type === "delete" || confirmAction.type === "revoke" ? "danger" : undefined}
                disabled={Boolean(busyKey)}
                onClick={() => {
                  if (confirmAction.type === "publish") {
                    const row = props.rows.find((entry) => entry.id === confirmAction.rowId);
                    if (row) void runPublish(row);
                    return;
                  }
                  if (confirmAction.type === "unpublish") {
                    const row = props.rows.find((entry) => entry.id === confirmAction.rowId);
                    if (row) void runUnpublish(row);
                    return;
                  }
                  if (confirmAction.type === "delete") {
                    const row = props.rows.find((entry) => entry.id === confirmAction.rowId);
                    if (row) void runDelete(row);
                    return;
                  }
                  const account = props.rows.find((entry) => entry.account?.accountId === confirmAction.rowId)?.account || null;
                  if (!account) return;
                  if (confirmAction.type === "revoke") {
                    void runAccountAction(account, "revoke");
                    return;
                  }
                  void runAccountAction(account, "suspend", confirmAction.days);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";

import { AvatarBadge, EmptyState, KeyValueGrid } from "@/components/admin/AdminPrimitives";

export type ApiKeyDeniedOriginSnapshot = {
  origin: string;
  attemptsLabel: string;
  dayLabel: string;
};

export type ApiKeyLifecycleSnapshot = {
  id: string;
  actionLabel: string;
  targetLabel: string;
  createdLabel: string;
  tone: "good" | "watch" | "bad";
};

export type ApiKeyPassportCardData = {
  id: string;
  name: string;
  typeLabel: string;
  statusLabel: string;
  statusTone: "good" | "watch" | "bad";
  maskedLabel: string;
  prefixLabel: string;
  scopeCountLabel: string;
  scopesLabel: string;
  accountLabel: string;
  projectLabel: string;
  siteLabel: string;
  verifiedLabel: string;
  deniedLabel: string;
  deniedOriginsLabel: string;
  createdLabel: string;
  lastUsedLabel: string;
  rotatedLabel: string;
  bindingLabel: string;
  summaryNote: string;
  deniedOrigins: ApiKeyDeniedOriginSnapshot[];
  lifecycle: ApiKeyLifecycleSnapshot[];
};

export function ApiKeyPassportGrid(props: {
  keys: ApiKeyPassportCardData[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeKey = props.keys.find((key) => key.id === activeId) || null;

  useEffect(() => {
    if (!activeKey) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveId(null);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeKey]);

  if (!props.keys.length) {
    return (
      <EmptyState
        title="No key passports yet."
        subtitle="As CavBot issues API keys and captures widget traffic, passport cards will appear here with lifecycle, verification, and denied-origin detail."
      />
    );
  }

  return (
    <>
      <div className="hq-opsPassportGrid">
        {props.keys.map((key) => (
          <button
            key={key.id}
            type="button"
            className="hq-opsPassportCard"
            data-tone={key.statusTone === "bad" ? "alert" : key.statusTone === "watch" ? "configured" : "live"}
            onClick={() => setActiveId(key.id)}
            aria-haspopup="dialog"
            aria-label={`Open key passport for ${key.name}`}
          >
            <div className="hq-opsPassportEyebrow">{key.typeLabel}</div>
            <AvatarBadge name={key.name} email={key.maskedLabel} tone="blue" size="lg" />
            <div className="hq-opsPassportName" title={key.name}>{key.name}</div>
            <div className="hq-opsPassportMeta">{key.statusLabel} · {key.scopeCountLabel}</div>
            <div className="hq-opsPassportSub">{key.maskedLabel} · {key.lastUsedLabel}</div>
          </button>
        ))}
      </div>

      {activeKey ? (
        <div className="hq-clientModalRoot" role="dialog" aria-modal="true" aria-labelledby={`api-key-title-${activeKey.id}`}>
          <button
            type="button"
            className="hq-clientModalBackdrop"
            aria-label="Close key passport"
            onClick={() => setActiveId(null)}
          />
          <div className="hq-clientModalPanel">
            <div className="hq-clientModalTopbar">
              <div className="hq-clientModalHero">
                <AvatarBadge name={activeKey.name} email={activeKey.maskedLabel} tone="blue" size="lg" />
                <div className="hq-clientModalIdentity">
                  <div className="hq-clientModalTitleRow">
                    <h3 id={`api-key-title-${activeKey.id}`} className="hq-clientModalTitle">{activeKey.name}</h3>
                  </div>
                  <p className="hq-clientModalSub">{activeKey.typeLabel} · {activeKey.statusLabel}</p>
                  <p className="hq-clientModalEmail">{activeKey.summaryNote}</p>
                </div>
              </div>
              <button type="button" className="hq-clientModalClose" onClick={() => setActiveId(null)} aria-label="Close key passport">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="hq-clientModalStats">
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Verified</div>
                <div className="hq-clientStatValue">{activeKey.verifiedLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Denied</div>
                <div className="hq-clientStatValue">{activeKey.deniedLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Blocked origins</div>
                <div className="hq-clientStatValue">{activeKey.deniedOriginsLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Rotated</div>
                <div className="hq-clientStatValue">{activeKey.rotatedLabel}</div>
              </article>
            </div>

            <KeyValueGrid
              items={[
                { label: "Masked key", value: activeKey.maskedLabel },
                { label: "Prefix", value: activeKey.prefixLabel },
                { label: "Scopes", value: activeKey.scopesLabel },
                { label: "Bindings", value: activeKey.bindingLabel },
                { label: "Account", value: activeKey.accountLabel },
                { label: "Project", value: activeKey.projectLabel },
                { label: "Site", value: activeKey.siteLabel },
                { label: "Created", value: activeKey.createdLabel },
                { label: "Last used", value: activeKey.lastUsedLabel },
              ]}
            />

            <section className="hq-clientWorkspaceSection">
              <div className="hq-clientWorkspaceHead">
                <h4 className="hq-clientWorkspaceTitle">Denied origins</h4>
                <p className="hq-clientWorkspaceSub">Origins CavBot blocked or rate-limited for this key in the current reporting window.</p>
              </div>
              {activeKey.deniedOrigins.length ? (
                <div className="hq-clientWorkspaceGrid">
                  {activeKey.deniedOrigins.map((origin) => (
                    <article key={`${activeKey.id}-${origin.origin}-${origin.dayLabel}`} className="hq-clientWorkspaceCard">
                      <div className="hq-clientWorkspaceRow">
                        <strong className="hq-clientWorkspaceName">{origin.origin}</strong>
                        <span className="hq-clientWorkspaceStatus" data-status="blocked">
                          blocked
                        </span>
                      </div>
                      <p className="hq-clientWorkspaceMeta">{origin.attemptsLabel}</p>
                      <p className="hq-clientWorkspaceTrial">{origin.dayLabel}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No blocked origins."
                  subtitle="This key has not recorded denied-origin or rate-limit rows in the current dataset."
                />
              )}
            </section>

            <section className="hq-clientWorkspaceSection">
              <div className="hq-clientWorkspaceHead">
                <h4 className="hq-clientWorkspaceTitle">Lifecycle</h4>
                <p className="hq-clientWorkspaceSub">Create, rotate, revoke, and use signals recorded by CavBot audit logging.</p>
              </div>
              {activeKey.lifecycle.length ? (
                <div className="hq-list">
                  {activeKey.lifecycle.map((entry) => (
                    <div key={entry.id} className="hq-listRow">
                      <div>
                        <div className="hq-listLabel">{entry.actionLabel}</div>
                        <div className="hq-listMeta">{entry.targetLabel}</div>
                      </div>
                      <div className="hq-inlineStart">
                        <span className="hq-opsLifecycleDot" data-tone={entry.tone} aria-hidden="true" />
                        <span className="hq-listMeta">{entry.createdLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No lifecycle rows yet."
                  subtitle="This key has no matching create, rotate, revoke, use, or denied-origin audit rows in the current reporting window."
                />
              )}
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}

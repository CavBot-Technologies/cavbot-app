"use client";

import { useEffect, useState } from "react";

import { AvatarBadge, EmptyState, KeyValueGrid } from "@/components/admin/AdminPrimitives";

export type NotFoundRecoverySiteSnapshot = {
  id: string;
  label: string;
  origin: string;
  accountLabel: string;
  projectLabel: string;
  lastSeenLabel: string;
  installsLabel: string;
  recoveredLabel: string;
  views404Label: string;
  statusLabel: string;
};

export type NotFoundGamePassportCardData = {
  id: string;
  name: string;
  slug: string;
  version: string;
  thumbnailUrl?: string | null;
  tone: "live" | "configured" | "idle";
  configuredSitesLabel: string;
  liveOriginsLabel: string;
  workspacesLabel: string;
  recoveredLabel: string;
  views404Label: string;
  sessionsLabel: string;
  playersLabel: string;
  topScoreLabel: string;
  completionLabel: string;
  lastSeenLabel: string;
  telemetryLabel: string;
  summaryNote: string;
  siteSnapshots: NotFoundRecoverySiteSnapshot[];
};

export function NotFoundGamePassportGrid(props: {
  games: NotFoundGamePassportCardData[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeGame = props.games.find((game) => game.id === activeId) || null;

  useEffect(() => {
    if (!activeGame) return undefined;

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
  }, [activeGame]);

  if (!props.games.length) {
    return (
      <EmptyState
        title="No 404 game records yet."
        subtitle="As CavBot captures live 404 game installs and recovery telemetry, the passport grid will populate here."
      />
    );
  }

  return (
    <>
      <div className="hq-opsPassportGrid hq-notFoundPassportGrid">
        {props.games.map((game) => (
          <button
            key={game.id}
            type="button"
            className="hq-opsPassportCard hq-notFoundPassportCard"
            data-tone={game.tone}
            onClick={() => setActiveId(game.id)}
            aria-haspopup="dialog"
            aria-label={`Open 404 passport for ${game.name}`}
          >
            <div className="hq-notFoundPassportTablet" aria-hidden="true">
              <span className="hq-notFoundPassportTabletCamera" />
              <div className="hq-notFoundPassportTabletFrame">
                {game.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={game.thumbnailUrl} alt="" className="hq-notFoundPassportTabletImage" />
                ) : (
                  <div className="hq-notFoundPassportTabletFallback">
                    <AvatarBadge
                      name={game.name}
                      email={game.slug}
                      tone="navy"
                      size="lg"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="hq-opsPassportName" title={game.name}>{game.name}</div>
            <div className="hq-opsPassportMeta">{game.configuredSitesLabel} · {game.liveOriginsLabel}</div>
            <div className="hq-opsPassportSub">{game.topScoreLabel} · {game.playersLabel}</div>
          </button>
        ))}
      </div>

      {activeGame ? (
        <div className="hq-clientModalRoot" role="dialog" aria-modal="true" aria-labelledby={`not-found-game-title-${activeGame.id}`}>
          <button
            type="button"
            className="hq-clientModalBackdrop"
            aria-label="Close 404 passport"
            onClick={() => setActiveId(null)}
          />
          <div className="hq-clientModalPanel">
            <div className="hq-clientModalTopbar">
              <div className="hq-clientModalHero">
                <AvatarBadge
                  name={activeGame.name}
                  email={activeGame.slug}
                  image={activeGame.thumbnailUrl}
                  tone="navy"
                  size="lg"
                />
                <div className="hq-clientModalIdentity">
                  <div className="hq-clientModalTitleRow">
                    <h3 id={`not-found-game-title-${activeGame.id}`} className="hq-clientModalTitle">{activeGame.name}</h3>
                  </div>
                  <p className="hq-clientModalSub">{activeGame.slug}</p>
                  <p className="hq-clientModalEmail">{activeGame.summaryNote}</p>
                </div>
              </div>
              <button type="button" className="hq-clientModalClose" onClick={() => setActiveId(null)} aria-label="Close 404 passport">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="hq-clientModalStats">
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Configured sites</div>
                <div className="hq-clientStatValue">{activeGame.configuredSitesLabel.replace(/^Configured on\s+/i, "")}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Live origins</div>
                <div className="hq-clientStatValue">{activeGame.liveOriginsLabel.replace(/^Live on\s+/i, "")}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Recovered sessions</div>
                <div className="hq-clientStatValue">{activeGame.recoveredLabel}</div>
              </article>
              <article className="hq-clientStatCard">
                <div className="hq-clientStatLabel">Top score</div>
                <div className="hq-clientStatValue">{activeGame.topScoreLabel.replace(/^Top score\s+/i, "")}</div>
              </article>
            </div>

            <KeyValueGrid
              items={[
                { label: "Workspaces", value: activeGame.workspacesLabel },
                { label: "404 views", value: activeGame.views404Label },
                { label: "Game sessions", value: activeGame.sessionsLabel },
                { label: "Players", value: activeGame.playersLabel },
                { label: "Completion", value: activeGame.completionLabel },
                { label: "Last seen", value: activeGame.lastSeenLabel },
                { label: "Version", value: activeGame.version },
                { label: "Telemetry", value: activeGame.telemetryLabel },
              ]}
            />

            <section className="hq-clientWorkspaceSection">
              <div className="hq-clientWorkspaceHead">
                <h4 className="hq-clientWorkspaceTitle">Live footprint</h4>
                <p className="hq-clientWorkspaceSub">Configured sites, active origins, recovered sessions, and 404 exposure currently attributed to this game.</p>
              </div>
              {activeGame.siteSnapshots.length ? (
                <div className="hq-clientWorkspaceGrid">
                  {activeGame.siteSnapshots.map((site) => (
                    <article key={site.id} className="hq-clientWorkspaceCard">
                      <div className="hq-clientWorkspaceRow">
                        <strong className="hq-clientWorkspaceName">{site.label}</strong>
                        <span className="hq-clientWorkspaceStatus" data-status={site.statusLabel.toLowerCase().replace(/\s+/g, "-")}>
                          {site.statusLabel}
                        </span>
                      </div>
                      <p className="hq-clientWorkspaceMeta">{site.accountLabel} · {site.projectLabel}</p>
                      <p className="hq-clientWorkspaceTrial">{site.origin}</p>
                      <p className="hq-clientWorkspaceTrial">{site.installsLabel}</p>
                      <p className="hq-clientWorkspaceTrial">{site.recoveredLabel} · {site.views404Label} · {site.lastSeenLabel}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No live footprint yet."
                  subtitle="This game is in the catalog, but CavBot has not captured a configured site or live install for it in the current dataset."
                />
              )}
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}

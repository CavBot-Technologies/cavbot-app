"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import CavBotLoadingScreen from "@/components/CavBotLoadingScreen";
import "@/components/CavBotLoadingScreen.css";

const LOADING_LANGUAGES = [
  "Loading…",
  "Chargement…",
  "Cargando…",
  "Caricamento…",
  "読み込み中…",
];

const PREVIEW_GAMES = [
  {
    title: "Pick The Imposter",
    description:
      "Scan a lineup of signal units and call out the imposters in calm, intentional rounds.",
    thumbnail: "/cavbot-arcade/demo/thumbnails/cavbot-imposter-thumbnail.png",
  },
  {
    title: "Tennis CavBot",
    description:
      "Serve + rally with clean inputs — quick matches, premium feedback, structured telemetry.",
    thumbnail: "/cavbot-arcade/demo/thumbnails/cavbot-tennis-thumbnail.png",
  },
  {
    title: "Cache Sweep",
    description:
      "Hit the stale blobs, protect the fresh signal, and keep the cache tidy with calm precision.",
    thumbnail: "/cavbot-arcade/demo/thumbnails/cavbot-cache-sweep-thumbnail.png",
  },
];

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (event: MediaQueryListEvent | MediaQueryList) => {
      setPrefersReducedMotion(event.matches);
    };
    update(query);
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
    } else if (typeof query.addListener === "function") {
      query.addListener(update);
    }
    return () => {
      if (typeof query.removeEventListener === "function") {
        query.removeEventListener("change", update);
      } else if (typeof query.removeListener === "function") {
        query.removeListener(update);
      }
    };
  }, []);

  return prefersReducedMotion;
}

export default function ArcadeLandingClient() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const duration = prefersReducedMotion ? 1600 : 3200;
    const timer = window.setTimeout(() => setIsReady(true), duration);
    return () => window.clearTimeout(timer);
  }, [prefersReducedMotion]);

  return (
    <div className="arcade-landing-shell">
      <div className="ambient" aria-hidden="true">
        <span className="beacon violet" style={{ left: "10%", top: "140px" }} />
        <span className="beacon lime" style={{ left: "92%", top: "220px" }} />
        <span className="beacon ice" style={{ left: "86%", top: "560px" }} />
        <span className="beacon violet" style={{ left: "16%", top: "860px" }} />
        <span className="beacon lime" style={{ left: "92%", top: "1120px" }} />
      </div>

      <div className={`arcade-content ${isReady ? "is-visible" : ""}`}>
        <section className="arcade-hero" aria-label="CavBot Arcade hero">
          <div className="arcade-mark-stage">
            <Image
              src="/logo/cavbot-arcade-logo-neon.png"
              alt="CavBot Arcade mark"
              width={420}
              height={160}
              className="cavbot-mark"
              priority
            />
            <h2 className="arcade-title">
              <span>Action. Signals. Puzzles.</span>
              <span className="arcade-title--play">Adventure begins here.</span>
            </h2>
            <p className="mark-caption">
              CavBot Arcade gives you instant access to premium 404 mini-games — no download, no account, no
              setup. Quick rounds, clean controls, and smooth glass UI built right into the grid. Chase signal,
              spot the imposter, rally in the control room, and restore routes while the logs stay alive. New games
              and upgrades drop over time, so there&apos;s always something fresh to run. It&apos;s the most fun place
              to land on a broken link — ready whenever, wherever.
            </p>
            <div className="mark-pills" aria-hidden="true">
              <span className="pill is-violet">Intentional 404</span>
              <span className="pill is-ice">Behavior Signal</span>
              <span className="pill is-lime">Measured Outcomes</span>
              <span className="pill is-blue">Instant Play</span>
            </div>
          </div>

          <div className="tablet" role="region" aria-label="Arcade hero showcase">
            <div className="tablet-topbar">
              <div className="tablet-dots" aria-hidden="true">
                <span className="tablet-dot" />
                <span className="tablet-dot" />
                <span className="tablet-dot" />
              </div>
            </div>
            <div className="tablet-screen">
              <div className="hero-preview" role="img" aria-label="Arcade hero preview">
                <Image
                  src="/cavbot-arcade/demo/thumbnails/cavbot-arcade-thumbnail.png"
                  alt="CavBot Arcade preview"
                  fill
                  className="hero-preview-media"
                  sizes="(max-width: 720px) 90vw, 640px"
                  priority
                />
              </div>
              <div className="passport-row">
                <Link className="btn btn-primary" href="/cavbot-arcade/gallery">
                  Open Arcade Library
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="preview-strip" aria-label="Arcade preview strip">
          <div className="preview-strip-heading">
            <div>
              <div className="eyebrow">Arcade Library</div>
              <h2>Preview the premium picks</h2>
            </div>
            <p>
              Only the freshest games make the cut. Each preview is a tablet frame with the calm CavBot polish you
              expect — centered, responsive, and ready to keep your 404 recovery surface feeling intentional.
            </p>
          </div>
          <div className="preview-grid">
            {PREVIEW_GAMES.map((game) => (
              <article key={game.title} className="preview-card" aria-label={`${game.title} preview`}>
                <div className="preview-card-screen">
                  <Image
                    src={game.thumbnail}
                    alt={`${game.title} thumbnail`}
                    fill
                    className="preview-card-media"
                    sizes="(max-width: 720px) 90vw, 320px"
                  />
                </div>
                <div className="preview-card-body">
                  <p className="preview-card-title">{game.title}</p>
                  <p>{game.description}</p>
                  <div className="preview-card-footer">
                    <Link className="btn btn-primary" href="/cavbot-arcade/gallery">
                      Open Arcade Library
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="arcade-cta" aria-label="Arcade call to action">
          <div>
            <div className="eyebrow">Next</div>
            <h2>Make your 404 experience intentional</h2>
            <p>
              Build the recovery surface. Add the arcade layer. Keep it premium. Keep it measurable. CavBot Arcade
              is an in-grid moment that boosts signal while you keep calm.
            </p>
          </div>
          <div className="cta-actions">
            <Link className="btn btn-primary" href="/cavbot-arcade/gallery">
              Open Arcade Library
            </Link>
            <Link className="btn btn-ghost" href="/console">
              Back to Console
            </Link>
          </div>
        </section>
      </div>

      <div className={`arcade-loading-layer ${isReady ? "is-hidden" : ""}`} aria-hidden={isReady}>
        <CavBotLoadingScreen
          title="Loading…"
          greetingPhrases={prefersReducedMotion ? undefined : LOADING_LANGUAGES}
          greetingIntervalMs={prefersReducedMotion ? undefined : 900}
          className={`arcade-loading-content ${prefersReducedMotion ? "is-reduced-motion" : ""}`}
        />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import CavBotLoadingScreen from "@/components/CavBotLoadingScreen";
import { loadEntertainmentGameSrcDoc, type EntertainmentSrcDocResult } from "@/lib/arcade/entertainmentLauncher.client";

type Game = { slug: string; title: string };

const ENT_LAUNCH_KEY = "cb_ent_launch_v1";

export default function EntertainmentOverlay({
  game,
  onClose,
}: {
  game: Game | null;
  onClose: () => void;
}) {
  const [srcDoc, setSrcDoc] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const cleanupRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    if (!game) return;

    setLoading(true);
    setError("");
    setSrcDoc("");

    let alive = true;
    (async () => {
      try {
        const result: EntertainmentSrcDocResult = await loadEntertainmentGameSrcDoc({
          slug: game.slug,
          version: "v1",
          title: game.title,
        });
        if (!alive) {
          result.cleanup();
          return;
        }
        cleanupRef.current?.();
        cleanupRef.current = result.cleanup;
        setSrcDoc(result.srcDoc);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "Launch failed.");
        if (/unauthorized/i.test(msg)) {
          // Use the existing auth flow. After login, the page will reopen via globalThis.__cbSessionStore.
          try {
            globalThis.__cbSessionStore.setItem(
              ENT_LAUNCH_KEY,
              JSON.stringify({ slug: game.slug, title: game.title, ts: Date.now() })
            );
          } catch {}
          const current = new URL(window.location.href);
          const next = `${current.pathname}${current.search}${current.hash || ""}`;
          window.location.href = `/auth?next=${encodeURIComponent(next)}`;
          return;
        }
        setError(msg);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [game]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!game) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [game, onClose]);

  if (!game) return null;

  return (
    <div className="ent-overlay" role="dialog" aria-modal="true" aria-label={`${game.title} player`}>
      <div className="ent-overlay-body">
        {loading && (
          <CavBotLoadingScreen
            title={game.title}
            className="ent-loading"
          />
        )}
        {!loading && error && <div className="ent-overlay-status ent-overlay-error">{error}</div>}
        {!loading && !error && (
          <iframe
            className="ent-overlay-frame"
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            title={game.title}
          />
        )}
      </div>
    </div>
  );
}

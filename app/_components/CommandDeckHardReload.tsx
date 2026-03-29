"use client";

import { useEffect } from "react";

const HARD_PARAM = "__hard";

export default function CommandDeckHardReload() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== "/command-deck") return;

    const visitKey = "cavbot:hardreload:/command-deck";
    const url = new URL(window.location.href);

    const isHardPass = url.searchParams.get(HARD_PARAM) === "1";

    const doHardReload = () => {
      // If we are already on the hard-pass load, clear the visit flag and stop.
      if (isHardPass) {
        globalThis.__cbSessionStore.removeItem(visitKey);
        return;
      }

      // Prevent infinite loop on the same visit
      const already = globalThis.__cbSessionStore.getItem(visitKey) === "1";
      if (already) return;

      globalThis.__cbSessionStore.setItem(visitKey, "1");

      // Cache-bust + mark hard pass
      const next = new URL(window.location.href);
      next.searchParams.set(HARD_PARAM, "1");
      next.searchParams.set("__ts", String(Date.now()));

      window.location.replace(next.toString());
    };

    // Run once on mount (normal navigation)
    doHardReload();

    // KEY FIX: BFCache restore (this is what Cmd+R “fixes” for you)
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        globalThis.__cbSessionStore.removeItem(visitKey);
        const next = new URL(window.location.href);
        next.searchParams.set(HARD_PARAM, "1");
        next.searchParams.set("__ts", String(Date.now()));
        window.location.replace(next.toString());
      }
    };

    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return null;
}

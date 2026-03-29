"use client";

import { useEffect, useRef } from "react";

// NOTE: router.refresh() intentionally removed.
// This bridge now ONLY syncs selection -> server (cookie pointers),
// without forcing UI refresh loops.

type SyncCallback = () => void;

function debounce(fn: SyncCallback, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(), ms);
  };
}

const KEY_ACTIVE_PROJECT_ID = "cb_active_project_id";

// Project-scoped keys written by Command Deck
const KEY_WORKSPACE_V_PREFIX = "cb_workspace_v__";
const KEY_ACTIVE_SITE_ORIGIN_PREFIX = "cb_active_site_origin__";
const KEY_TOP_SITE_ORIGIN_PREFIX = "cb_top_site_origin__";
const KEY_ACTIVE_SITE_ID_PREFIX = "cb_active_site_id__"; // optional

const SYNC_ENDPOINT = "/api/workspaces/selection";

function getLS(key: string): string {
  try {
    return (globalThis.__cbLocalStore.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function getActiveProjectIdSafe(): string {
  return getLS(KEY_ACTIVE_PROJECT_ID) || "1";
}

function getWorkspaceVersionSafe(projectId: string): string {
  return getLS(`${KEY_WORKSPACE_V_PREFIX}${projectId}`);
}

function getActiveSiteOriginSafe(projectId: string): string {
  return getLS(`${KEY_ACTIVE_SITE_ORIGIN_PREFIX}${projectId}`);
}

function getTopSiteOriginSafe(projectId: string): string {
  return getLS(`${KEY_TOP_SITE_ORIGIN_PREFIX}${projectId}`);
}

function getActiveSiteIdSafe(projectId: string): string {
  return getLS(`${KEY_ACTIVE_SITE_ID_PREFIX}${projectId}`);
}

function isWorkspaceSignalKey(k: string) {
  return (
    k === KEY_ACTIVE_PROJECT_ID ||
    k.startsWith(KEY_WORKSPACE_V_PREFIX) ||
    k.startsWith(KEY_ACTIVE_SITE_ORIGIN_PREFIX) ||
    k.startsWith(KEY_TOP_SITE_ORIGIN_PREFIX) ||
    k.startsWith(KEY_ACTIVE_SITE_ID_PREFIX)
  );
}

export default function ConsoleSyncBridge() {
  const lastProjectIdRef = useRef<string>("1");
  const lastWorkspaceVRef = useRef<string>("");

  const lastActiveOriginRef = useRef<string>("");
  const lastTopOriginRef = useRef<string>("");
  const lastActiveIdRef = useRef<string>("");

  // Prevent repeated identical POSTs
  const lastServerSigRef = useRef<string>("");

  // Abort in-flight sync when a newer one happens
  const inflightAbortRef = useRef<AbortController | null>(null);

  // Simple “cooldown” to prevent tight loops from noisy events
  const lastSyncAtRef = useRef<number>(0);

  useEffect(() => {
    const snapshot = () => {
      const projectId = getActiveProjectIdSafe();
      return {
        projectId,
        workspaceV: getWorkspaceVersionSafe(projectId),
        activeSiteOrigin: getActiveSiteOriginSafe(projectId),
        topSiteOrigin: getTopSiteOriginSafe(projectId),
        activeSiteId: getActiveSiteIdSafe(projectId),
      };
    };

    const syncRefsFromSnapshot = (snap: ReturnType<typeof snapshot>) => {
      lastProjectIdRef.current = snap.projectId;
      lastWorkspaceVRef.current = snap.workspaceV;
      lastActiveOriginRef.current = snap.activeSiteOrigin;
      lastTopOriginRef.current = snap.topSiteOrigin;
      lastActiveIdRef.current = snap.activeSiteId;
    };

    const makeSig = (snap: ReturnType<typeof snapshot>) =>
      [
        snap.projectId,
        snap.workspaceV,
        snap.activeSiteOrigin,
        snap.topSiteOrigin,
        snap.activeSiteId,
      ].join("|");

    const syncToServer = async () => {
      const now = Date.now();
      if (now - lastSyncAtRef.current < 150) return; // tiny safety
      lastSyncAtRef.current = now;

      const snap = snapshot();
      const sig = makeSig(snap);

      if (sig === lastServerSigRef.current) return;
      lastServerSigRef.current = sig;

      // Abort prior in-flight request
      try {
        inflightAbortRef.current?.abort();
      } catch {
        // no-op
      }
      const ac = new AbortController();
      inflightAbortRef.current = ac;

      try {
        const res = await fetch(SYNC_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: snap.projectId,
            workspaceV: snap.workspaceV,
            activeSiteOrigin: snap.activeSiteOrigin,
            topSiteOrigin: snap.topSiteOrigin,
            activeSiteId: snap.activeSiteId,
          }),
          credentials: "include",
          signal: ac.signal,
          cache: "no-store",
        });

        // If server rejected, allow future retries (don’t “stick”)
        if (!res.ok) {
          lastServerSigRef.current = "";
        }
      } catch {
        // If aborted or network error, allow future retries
        lastServerSigRef.current = "";
      }
    };

    const debouncedSync = debounce(syncToServer, 180);

    // init
    syncRefsFromSnapshot(snapshot());
    debouncedSync();

    const onWorkspace: EventListener = () => {
      syncRefsFromSnapshot(snapshot());
      debouncedSync();
    };

    const onSelection: EventListener = () => {
      syncRefsFromSnapshot(snapshot());
      debouncedSync();
    };

    window.addEventListener("cb:workspace", onWorkspace);
    window.addEventListener("cb:selection", onSelection);

    const onStorage = (e: StorageEvent) => {
      const k = e.key || "";
      if (!k) return;
      if (!isWorkspaceSignalKey(k)) return;
      syncRefsFromSnapshot(snapshot());
      debouncedSync();
    };

    window.addEventListener("storage", onStorage);

    const poll = () => {
      try {
        if (document.visibilityState === "hidden") return;

        const snap = snapshot();
        const changed =
          snap.projectId !== lastProjectIdRef.current ||
          snap.workspaceV !== lastWorkspaceVRef.current ||
          snap.activeSiteOrigin !== lastActiveOriginRef.current ||
          snap.topSiteOrigin !== lastTopOriginRef.current ||
          snap.activeSiteId !== lastActiveIdRef.current;

        if (changed) {
          syncRefsFromSnapshot(snap);
          debouncedSync();
        }
      } catch {
        // no-op
      }
    };

    const pollId = window.setInterval(poll, 900);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        syncRefsFromSnapshot(snapshot());
        debouncedSync();
      }
    };

    // Also flush sync when leaving the page
    const onPageHide = () => {
      syncRefsFromSnapshot(snapshot());
      // fire immediately (not debounced) on exit
      syncToServer();
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("cb:workspace", onWorkspace);
      window.removeEventListener("cb:selection", onSelection);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(pollId);

      try {
        inflightAbortRef.current?.abort();
      } catch {
        // no-op
      }
    };
  }, []);

  return null;
}

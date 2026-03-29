"use client";

import { useEffect } from "react";

const CRITICAL_ICON_URLS = [
  "/icons/app/smart-optimization-svgrepo-com.svg",
  "/icons/history-svgrepo-coom.svg",
  "/icons/expand-svgrepo-com.svg",
  "/icons/x-symbol-svgrepo-com.svg",
  "/icons/app/cavcode/write-a-note-svgrepo-com.svg",
  "/icons/app/cavcode/plus-large-svgrepo-com.svg",
  "/icons/app/cavcode/3d-modelling-round-820-svgrepo-com.svg",
  "/icons/app/cavcode/brain-svgrepo-com.svg",
  "/icons/app/cavcode/arrow-up-circle-svgrepo-com.svg",
  "/icons/app/cavcode/stop-circle-svgrepo-com.svg",
  "/icons/app/microphone-svgrepo-com.svg",
  "/icons/app/sound-2-svgrepo-com.svg",
  "/icons/app/sound-max-svgrepo-com.svg",
  "/icons/copy-svgrepo-com.svg",
  "/icons/thumb-up-cavai.svg",
  "/icons/thumb-down-cavai.svg",
  "/icons/app/share-svgrepo-com.svg",
  "/icons/app/retry-svgrepo-com.svg",
  "/icons/app/workspace-svgrepo-com.svg",
  "/icons/app/deep-learning-svgrepo-com.svg",
  "/icons/app/image-combiner-svgrepo-com.svg",
  "/icons/app/image-edit-svgrepo-com.svg",
  "/icons/app/file-blank-svgrepo-com.svg",
  "/icons/app/link-svgrepo-com.svg",
  "/icons/app/cavcode/atom-svgrepo-com.svg",
];

const SECONDARY_ICON_URLS = [
  "/icons/loading-svgrepo-com.svg",
  "/icons/layout-2-svgrepo-com.svg",
  "/icons/cavpad/notepad-svgrepo-com.svg",
  "/icons/security-svgrepo-com.svg",
  "/icons/app/security-protection-hand-shield-svgrepo-com.svg",
  "/icons/app/filter-svgrepo-com.svg",
  "/icons/app/info-square-svgrepo-com.svg",
  "/icons/app/arrow-square-down-svgrepo-com.svg",
  "/icons/app/arrow-square-up-svgrepo-com.svg",
  "/icons/app/block-svgrepo-com.svg",
  "/icons/app/card-pos-svgrepo-com.svg",
  "/icons/app/api-svgrepo-com.svg",
  "/icons/app/plug-outlet-1-svgrepo-com.svg",
  "/icons/app/sidebar-2-layout-toggle-nav-navbar-svgrepo-com.svg",
  "/icons/app/sidebar-3-right-svgrepo-com.svg",
  "/icons/share-2-svgrepo-com.svg",
  "/icons/folder-svgrepo-com.svg",
  "/icons/team-svgrepo-com.svg",
  "/icons/cavpad/edit-svgrepo-com.svg",
  "/icons/cavpad/magicwand-svgrepo-com.svg",
  "/icons/cavpad/pin1-svgrepo-com.svg",
  "/icons/cavpad/restore-svgrepo-com.svg",
  "/icons/cavpad/sparkles-svgrepo-com.svg",
  "/icons/cavpad/upload-svgrepo-com.svg",
  "/icons/app/cavcode/applications-system-svgrepo-com.svg",
  "/icons/app/cavcode/arrow-right-svgrepo-com.svg",
  "/icons/app/cavcode/arrow-down-svgrepo-com.svg",
  "/icons/app/cavcode/broadcast-svgrepo-com.svg",
  "/icons/app/cavcode/search-alt-svgrepo-com.svg",
  "/icons/app/cavcode/star-1-svgrepo-com.svg",
  "/icons/app/cavcode/steer-svgrepo-com.svg",
  "/icons/app/cavcode/cloud-plus-svgrepo-com.svg",
  "/icons/app/cavcode/cloud-storage-svgrepo-com.svg",
  "/icons/app/cavcode/collapse-svgrepo-com.svg",
  "/icons/app/cavcode/debug-alt-small-svgrepo-com.svg",
  "/icons/app/cavcode/file-add-svgrepo-com.svg",
  "/icons/app/cavcode/files-stack-svgrepo-com.svg",
  "/icons/app/cavcode/folder-2-svgrepo-com.svg",
  "/icons/app/cavcode/folder-add-svgrepo-com.svg",
  "/icons/app/cavcode/folder-upload-svgrepo-com.svg",
  "/icons/app/cavcode/refresh-cw-svgrepo-com.svg",
  "/icons/app/cavcode/settings-svgrepo-com.svg",
  "/icons/app/cavcode/split-cells-horizontal-svgrepo-com.svg",
  "/icons/app/cavcode/split-cells-vertical-svgrepo-com.svg",
  "/icons/app/safari-option-svgrepo-com.svg",
  "/icons/back-svgrepo-com.svg",
  "/logo/cavbot-logomark.svg",
];

const warmedIconUrls = new Set<string>();

function warmSvgIcons(urls: readonly string[], priority: "high" | "auto") {
  for (const src of urls) {
    if (warmedIconUrls.has(src)) continue;
    warmedIconUrls.add(src);
    const img = new Image();
    img.decoding = "async";
    try {
      (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = priority;
    } catch {}
    img.src = src;
  }
}

export default function IconWarmup() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    warmSvgIcons(CRITICAL_ICON_URLS, "high");

    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let idleId: number | null = null;
    let timeoutId: number | null = null;

    const warmSecondary = () => warmSvgIcons(SECONDARY_ICON_URLS, "auto");
    if (typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(warmSecondary, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(warmSecondary, 120);
    }

    return () => {
      if (idleId !== null && typeof win.cancelIdleCallback === "function") {
        win.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  return null;
}

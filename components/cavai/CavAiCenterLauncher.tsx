"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import CavAiCenterWorkspace, { type AiCenterSurface } from "./CavAiCenterWorkspace";
import styles from "./CavAiWorkspace.module.css";

export type { AiCenterSurface } from "./CavAiCenterWorkspace";

export type CavAiCenterLauncherProps = {
  surface: AiCenterSurface;
  contextLabel?: string;
  context?: Record<string, unknown>;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  expandHref?: string;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  triggerClassName?: string;
  iconOnly?: boolean;
  iconClassName?: string;
  iconSizePx?: number;
  preload?: boolean;
};

const CENTER_OVERLAY_ASSET_URLS = [
  "/icons/app/smart-optimization-svgrepo-com.svg",
  "/icons/history-svgrepo-coom.svg",
  "/icons/expand-svgrepo-com.svg",
  "/icons/close-svgrepo-com.svg",
  "/icons/chevron-left-svgrepo-com.svg",
  "/icons/chevron-right-svgrepo-com.svg",
  "/icons/app/cavcode/write-a-note-svgrepo-com.svg",
  "/icons/app/cavcode/plus-large-svgrepo-com.svg",
  "/icons/app/cavcode/3d-modelling-round-820-svgrepo-com.svg",
  "/icons/app/cavcode/brain-svgrepo-com.svg",
  "/icons/app/microphone-svgrepo-com.svg",
  "/icons/app/cavcode/arrow-up-circle-svgrepo-com.svg",
  "/icons/app/cavcode/stop-circle-svgrepo-com.svg",
];

const preloadedAssetUrls = new Set<string>();

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function preloadCenterOverlayAssets(): void {
  if (typeof window === "undefined") return;
  for (const url of CENTER_OVERLAY_ASSET_URLS) {
    if (!url || preloadedAssetUrls.has(url)) continue;
    preloadedAssetUrls.add(url);
    const image = new window.Image();
    image.decoding = "async";
    image.src = url;
  }
}

export default function CavAiCenterLauncher(props: CavAiCenterLauncherProps) {
  const [open, setOpen] = useState(false);
  const [workspaceMounted, setWorkspaceMounted] = useState(() => Boolean(props.preload));

  const triggerClass = useMemo(() => {
    if (props.triggerClassName) return props.triggerClassName;
    return styles.triggerPill;
  }, [props.triggerClassName]);

  const warm = useCallback(() => {
    preloadCenterOverlayAssets();
    setWorkspaceMounted(true);
  }, []);

  const centerHref = useMemo(() => {
    const fromProps = s(props.expandHref);
    if (fromProps) return fromProps;
    const qp = new URLSearchParams();
    qp.set("surface", s(props.surface) || "general");
    if (s(props.contextLabel)) qp.set("context", s(props.contextLabel));
    if (s(props.workspaceId)) qp.set("workspaceId", s(props.workspaceId));
    const projectId = Number(props.projectId);
    if (Number.isFinite(projectId) && projectId > 0) {
      qp.set("projectId", String(Math.trunc(projectId)));
    }
    if (s(props.origin)) qp.set("origin", s(props.origin));
    return `/cavai?${qp.toString()}`;
  }, [
    props.contextLabel,
    props.expandHref,
    props.origin,
    props.projectId,
    props.surface,
    props.workspaceId,
  ]);

  useEffect(() => {
    if (!props.preload) return;
    let timeoutId = 0;
    const idleRunner = window.requestIdleCallback;
    const idleCancel = window.cancelIdleCallback;
    if (typeof idleRunner === "function") {
      const idleId = idleRunner(() => warm(), { timeout: 1200 });
      return () => {
        if (typeof idleCancel === "function") idleCancel(idleId);
      };
    }
    timeoutId = window.setTimeout(() => warm(), 120);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [props.preload, warm]);

  const overlay =
    workspaceMounted && typeof document !== "undefined"
      ? createPortal(
          <CavAiCenterWorkspace
            surface={props.surface}
            contextLabel={props.contextLabel}
            context={props.context}
            workspaceId={props.workspaceId}
            projectId={props.projectId}
            origin={props.origin}
            overlay
            open={open}
            preload
            onClose={() => setOpen(false)}
            expandHref={centerHref}
          />,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        aria-label={props.triggerAriaLabel || "Open CavAi"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerDown={warm}
        onMouseEnter={warm}
        onFocus={warm}
        onClick={() => {
          warm();
          setOpen(true);
        }}
      >
        {props.iconOnly ? (
          <span
            className={[styles.aiSparklesIcon, props.iconClassName || ""].filter(Boolean).join(" ")}
            aria-hidden="true"
            style={
              props.iconSizePx
                ? ({
                    width: props.iconSizePx,
                    height: props.iconSizePx,
                    flex: `0 0 ${props.iconSizePx}px`,
                  } as CSSProperties)
                : undefined
            }
          />
        ) : (
          props.triggerLabel || "CavAi"
        )}
      </button>

      {overlay}
    </>
  );
}

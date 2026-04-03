"use client";

import { useEffect } from "react";

type ManagedEye = {
  inner: HTMLElement;
  track: HTMLElement;
  centerX: number;
  centerY: number;
  currentX: number;
  currentY: number;
  phase: number;
};

const EYE_SELECTOR = ".cavbot-eye-pupil";
const TRACKER_SELECTOR = ".cavbot-eye-pupil, .cavbot-eye-inner, .cavbot-dm-avatar, [data-cavbot-head]";
const MAX_SHIFT_X = 2.15;
const MAX_SHIFT_Y = 1.55;
const EASE = 0.16;
const IDLE_X = 0.82;
const IDLE_Y = 0.52;
const POINTER_COOLDOWN_MS = 1800;
const POINTER_PULL_DISTANCE = 132;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nodeContainsTracker(node: Node) {
  if (!(node instanceof Element)) return false;
  if (node.matches(TRACKER_SELECTOR)) return true;
  return Boolean(node.querySelector(TRACKER_SELECTOR));
}

function ensureTrack(pupil: HTMLElement) {
  const existingTrack = pupil.closest(".cavbot-eye-track");
  if (existingTrack instanceof HTMLElement) return existingTrack;

  const inner = pupil.closest(".cavbot-eye-inner");
  if (!(inner instanceof HTMLElement)) return null;

  const parent = pupil.parentElement;
  if (!parent) return null;

  const track = document.createElement("div");
  track.className = "cavbot-eye-track cavbot-eye-track--managed";
  parent.replaceChild(track, pupil);
  track.appendChild(pupil);
  return track;
}

export default function CavbotBadgeMotion() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let eyes: ManagedEye[] = [];
    let rafId = 0;
    let mutationFrame = 0;
    let destroyed = false;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let lastPointerTs = 0;

    const previousEyeRefresh = window.__cavbotEyeTrackingRefresh;
    const previousHeadRefresh = window.__cavbotHeadTrackingRefresh;

    const measure = () => {
      eyes.forEach((eye) => {
        const rect = eye.inner.getBoundingClientRect();
        eye.centerX = rect.left + rect.width / 2;
        eye.centerY = rect.top + rect.height / 2;
      });
      window.__cavbotEyeTrackingLastRefresh = Date.now();
      window.__cavbotEyeTrackingReady = eyes.length > 0;
    };

    const collect = () => {
      const previousEyes = new Map(eyes.map((eye) => [eye.track, eye]));
      const nextEyes: ManagedEye[] = [];
      const pupils = Array.from(document.querySelectorAll<HTMLElement>(EYE_SELECTOR));

      pupils.forEach((pupil, index) => {
        const inner = pupil.closest(".cavbot-eye-inner");
        if (!(inner instanceof HTMLElement)) return;

        const track = ensureTrack(pupil);
        if (!(track instanceof HTMLElement)) return;

        const previous = previousEyes.get(track);
        nextEyes.push({
          inner,
          track,
          centerX: previous?.centerX ?? 0,
          centerY: previous?.centerY ?? 0,
          currentX: previous?.currentX ?? 0,
          currentY: previous?.currentY ?? 0,
          phase: previous?.phase ?? index * 1.31,
        });
      });

      eyes = nextEyes;
      measure();
    };

    const queue = () => {
      if (destroyed || rafId) return;
      rafId = window.requestAnimationFrame((ts) => {
        rafId = 0;
        if (destroyed) return;

        const pointerActive = ts - lastPointerTs < POINTER_COOLDOWN_MS;
        eyes.forEach((eye) => {
          let targetX = 0;
          let targetY = 0;

          if (pointerActive) {
            const dx = pointerX - eye.centerX;
            const dy = pointerY - eye.centerY;
            const distance = Math.hypot(dx, dy) || 1;
            const pull = clamp(distance / POINTER_PULL_DISTANCE, 0, 1);
            targetX = clamp((dx / distance) * MAX_SHIFT_X * pull, -MAX_SHIFT_X, MAX_SHIFT_X);
            targetY = clamp((dy / distance) * MAX_SHIFT_Y * pull, -MAX_SHIFT_Y, MAX_SHIFT_Y);
          } else {
            targetX = Math.sin(ts / 920 + eye.phase) * IDLE_X;
            targetY = Math.cos(ts / 1220 + eye.phase * 1.17) * IDLE_Y;
          }

          eye.currentX += (targetX - eye.currentX) * EASE;
          eye.currentY += (targetY - eye.currentY) * EASE;
          eye.track.style.transform = `translate(${eye.currentX.toFixed(2)}px, ${eye.currentY.toFixed(2)}px)`;
        });

        queue();
      });
    };

    const refreshEyes = () => {
      previousEyeRefresh?.();
      collect();
      queue();
    };

    const refreshHead = () => {
      previousHeadRefresh?.();
      measure();
      queue();
    };

    const scheduleRefresh = () => {
      if (mutationFrame) return;
      mutationFrame = window.requestAnimationFrame(() => {
        mutationFrame = 0;
        refreshEyes();
      });
    };

    const onPointerMove = (event: PointerEvent | MouseEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      lastPointerTs = performance.now();
      queue();
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      pointerX = touch.clientX;
      pointerY = touch.clientY;
      lastPointerTs = performance.now();
      queue();
    };

    const onViewportChange = () => {
      measure();
      queue();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      refreshEyes();
    };

    collect();
    queue();

    window.__cavbotEyeTrackingRefresh = refreshEyes;
    window.__cavbotHeadTrackingRefresh = refreshHead;

    const observer = new MutationObserver((records) => {
      if (records.some((record) => {
        if (nodeContainsTracker(record.target)) return true;
        return Array.from(record.addedNodes).some(nodeContainsTracker) || Array.from(record.removedNodes).some(nodeContainsTracker);
      })) {
        scheduleRefresh();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("mousemove", onPointerMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("resize", onViewportChange, { passive: true });
    window.addEventListener("scroll", onViewportChange, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      destroyed = true;
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (mutationFrame) window.cancelAnimationFrame(mutationFrame);
      if (window.__cavbotEyeTrackingRefresh === refreshEyes) {
        window.__cavbotEyeTrackingRefresh = previousEyeRefresh;
      }
      if (window.__cavbotHeadTrackingRefresh === refreshHead) {
        window.__cavbotHeadTrackingRefresh = previousHeadRefresh;
      }
    };
  }, []);

  return null;
}

"use client";

import { useEffect } from "react";

type ManagedEye = {
  eye: HTMLElement;
  pupil: HTMLElement;
  centerX: number;
  centerY: number;
  maxShift: number;
};

const PUPIL_SELECTOR = ".cavbot-eye-pupil";
const TRACKER_SELECTOR = ".cavbot-eye-pupil, .cavbot-eye-inner, .cavbot-dm-avatar, [data-cavbot-head]";
const POINTER_IDLE_COOLDOWN_MS = 1200;
const POINTER_FALLOFF_DISTANCE = 180;
const IDLE_X_AMPLITUDE = 0.42;
const IDLE_Y_AMPLITUDE = 0.34;
const SHIFT_RATIO = 0.12;
const MIN_SHIFT = 2.4;
const MAX_SHIFT = 4.8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nodeContainsTracker(node: Node) {
  if (!(node instanceof Element)) return false;
  if (node.matches(TRACKER_SELECTOR)) return true;
  return Boolean(node.querySelector(TRACKER_SELECTOR));
}

export default function CavbotBadgeMotion() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let eyes: ManagedEye[] = [];
    let rafId = 0;
    let mutationFrame = 0;
    let destroyed = false;
    let pointerX = Math.max(window.innerWidth / 2, 0);
    let pointerY = Math.max(window.innerHeight / 2, 0);
    let lastPointerTs = performance.now();

    const previousEyeRefresh = window.__cavbotEyeTrackingRefresh;
    const previousHeadRefresh = window.__cavbotHeadTrackingRefresh;

    const measure = () => {
      eyes.forEach((eye) => {
        const rect = eye.eye.getBoundingClientRect();
        eye.centerX = rect.left + rect.width * 0.5;
        eye.centerY = rect.top + rect.height * 0.5;
        eye.maxShift = Math.min(MAX_SHIFT, Math.max(MIN_SHIFT, rect.width * SHIFT_RATIO));
      });
      window.__cavbotEyeTrackingLastRefresh = Date.now();
      window.__cavbotEyeTrackingReady = eyes.length > 0;
    };

    const collect = () => {
      const previousEyes = new Map(eyes.map((eye) => [eye.pupil, eye]));
      const nextEyes: ManagedEye[] = [];
      const pupils = Array.from(document.querySelectorAll<HTMLElement>(PUPIL_SELECTOR));

      pupils.forEach((pupil) => {
        const eye = pupil.closest(".cavbot-eye, .cavbot-dm-eye");
        if (!(eye instanceof HTMLElement)) return;

        const previous = previousEyes.get(pupil);
        nextEyes.push({
          eye,
          pupil,
          centerX: previous?.centerX ?? 0,
          centerY: previous?.centerY ?? 0,
          maxShift: previous?.maxShift ?? MIN_SHIFT,
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

        const idle = ts - lastPointerTs > POINTER_IDLE_COOLDOWN_MS;
        const idleX = idle ? Math.sin(ts / 920) * IDLE_X_AMPLITUDE : 0;
        const idleY = idle ? Math.cos(ts / 780) * IDLE_Y_AMPLITUDE : 0;

        eyes.forEach((eye) => {
          const dx = pointerX - eye.centerX;
          const dy = pointerY - eye.centerY;
          const distance = Math.hypot(dx, dy) || 1;
          const distFactor = Math.min(1, distance / POINTER_FALLOFF_DISTANCE);
          const shiftX = clamp((dx / distance) * eye.maxShift * distFactor + idleX, -eye.maxShift, eye.maxShift);
          const shiftY = clamp((dy / distance) * eye.maxShift * distFactor + idleY, -eye.maxShift, eye.maxShift);
          eye.pupil.style.transform = `translate3d(${shiftX.toFixed(2)}px, ${shiftY.toFixed(2)}px, 0)`;
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

    const markPointer = (clientX: number, clientY: number) => {
      pointerX = clientX;
      pointerY = clientY;
      lastPointerTs = performance.now();
      queue();
    };

    const onPointerMove = (event: PointerEvent | MouseEvent) => {
      markPointer(event.clientX, event.clientY);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      markPointer(touch.clientX, touch.clientY);
    };

    const onViewportChange = () => {
      if (performance.now() - lastPointerTs > 1500) {
        markPointer(Math.max(window.innerWidth / 2, 0), Math.max(window.innerHeight / 2, 0));
      } else {
        measure();
        queue();
      }
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

// app/_components/CavAiBoot.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useBrowserRouteSnapshot } from "./useBrowserRouteSnapshot";
import { shouldEnableRoutePerf, traceRenderCount } from "@/lib/dev/routePerf";

type CavAiWindow = Window & {
  cavai?: {
    boot?: () => void;
    enableHeadTracking?: () => void;
    enableEyeTracking?: () => void;
  };
  __cavaiHeadTrackingRefresh?: () => void;
  __cavaiEyeTrackingRefresh?: () => void;
};

export default function CavAiBoot() {
  const { pathname, searchParamsValue } = useBrowserRouteSnapshot();
  const perfLogging = useMemo(
    () => shouldEnableRoutePerf(searchParamsValue),
    [searchParamsValue],
  );
  const renderCountRef = useRef(0);

  useEffect(() => {
    renderCountRef.current += 1;
    traceRenderCount("CavAiBootProvider", perfLogging, {
      route: pathname,
      renderCount: renderCountRef.current,
    });
  }, [perfLogging, pathname]);

  useEffect(() => {
    const run = () => {
      const w = window as CavAiWindow;

      if (w.cavai?.boot) w.cavai.boot();
      if (w.cavai?.enableHeadTracking) w.cavai.enableHeadTracking();
      if (w.cavai?.enableEyeTracking) w.cavai.enableEyeTracking();

      if (typeof w.__cavaiHeadTrackingRefresh === "function") w.__cavaiHeadTrackingRefresh();
      if (typeof w.__cavaiEyeTrackingRefresh === "function") w.__cavaiEyeTrackingRefresh();
    };

    const t = setTimeout(run, 80);
    return () => clearTimeout(t);
  }, [pathname]);

  return null;
}

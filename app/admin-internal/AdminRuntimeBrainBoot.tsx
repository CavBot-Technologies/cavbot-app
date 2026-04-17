"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type AdminRuntimeWindow = Window & {
  cavai?: {
    boot?: () => void;
    enableHeadTracking?: () => void;
    enableEyeTracking?: () => void;
  };
  __cavaiHeadTrackingRefresh?: () => void;
  __cavaiEyeTrackingRefresh?: () => void;
  __cavbotHeadTrackingRefresh?: () => void;
  __cavbotEyeTrackingRefresh?: () => void;
};

function bootAdminEyeTracking() {
  const w = window as AdminRuntimeWindow;
  w.cavai?.boot?.();
  w.cavai?.enableHeadTracking?.();
  w.cavai?.enableEyeTracking?.();
  w.__cavaiHeadTrackingRefresh?.();
  w.__cavaiEyeTrackingRefresh?.();
  w.__cavbotHeadTrackingRefresh?.();
  w.__cavbotEyeTrackingRefresh?.();
}

export default function AdminRuntimeBrainBoot() {
  const pathname = usePathname();

  useEffect(() => {
    const timers = [0, 80, 240, 600, 1200, 2400].map((delay) =>
      window.setTimeout(() => {
        bootAdminEyeTracking();
      }, delay),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [pathname]);

  return null;
}

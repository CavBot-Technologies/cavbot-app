"use client";

import CavCloudClient from "./CavCloudClient";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

type CavCloudClientShellProps = {
  isOwner: boolean;
  cacheScopeKey?: string;
};

export default function CavCloudClientShell({ isOwner, cacheScopeKey }: CavCloudClientShellProps) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleId: number | null = null;
    let timeoutId: number | null = null;
    const warmCavSafeRoute = () => {
      try {
        router.prefetch("/cavsafe");
      } catch {
        // ignore prefetch failures and keep normal navigation
      }
    };
    try {
      if (typeof idleWindow.requestIdleCallback === "function") {
        idleId = idleWindow.requestIdleCallback(() => {
          warmCavSafeRoute();
        }, { timeout: 1200 });
      } else {
        timeoutId = window.setTimeout(warmCavSafeRoute, 220);
      }
    } catch {
      warmCavSafeRoute();
    }
    return () => {
      if (idleId !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [router]);

  return (
    <>
      <CavCloudClient isOwner={isOwner} cacheScopeKey={cacheScopeKey} />
    </>
  );
}

interface IdleRequestDeadline {
  didTimeout: boolean;
  timeRemaining: () => number;
}

interface IdleRequestOptions {
  timeout?: number;
}

type IdleRequestCallback = (deadline: IdleRequestDeadline) => void;

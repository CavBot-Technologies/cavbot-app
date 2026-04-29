import { Suspense } from "react";
import Script from "next/script";

import BrowserStoreBoot from "./BrowserStoreBoot";
import CavbotBadgeMotion from "./CavbotBadgeMotion";
import GlobalFooterMount from "./GlobalFooterMount";
import IconWarmup from "./IconWarmup";
import RouteLifecycle from "./RouteLifecycle";
import SystemStatusBootstrap from "@/components/status/SystemStatusBootstrap";
import { resolveCavbotAssetPolicy } from "@/lib/cavbotAssetPolicy";

const INTERNAL_RUNTIME_ASSETS = resolveCavbotAssetPolicy("internal_runtime");
const RUNTIME_PROJECT_KEY = process.env.NEXT_PUBLIC_CAVBOT_PROJECT_KEY || "";
const RUNTIME_SITE_ID =
  process.env.NEXT_PUBLIC_CAVBOT_SITE_PUBLIC_ID || process.env.NEXT_PUBLIC_CAVBOT_SITE_ID || "";

export function AppHostPreconnectLink() {
  return null;
}

export default function AppHostRuntimeMounts() {
  return (
    <>
      <Suspense fallback={null}>
        <BrowserStoreBoot />
      </Suspense>
      <Suspense fallback={null}>
        <RouteLifecycle />
      </Suspense>
      <Suspense fallback={null}>
        <CavbotBadgeMotion />
      </Suspense>
      <Suspense fallback={null}>
        <IconWarmup />
      </Suspense>
      <Suspense fallback={null}>
        <SystemStatusBootstrap />
      </Suspense>
      <Suspense fallback={null}>
        <GlobalFooterMount />
      </Suspense>
      <Script
        id="cb-runtime-analytics-script"
        src={INTERNAL_RUNTIME_ASSETS.scripts.analytics}
        strategy="afterInteractive"
        data-project-key={RUNTIME_PROJECT_KEY || undefined}
        data-site-id={RUNTIME_SITE_ID || undefined}
      />
      <Script
        id="cb-runtime-brain-script"
        src={INTERNAL_RUNTIME_ASSETS.scripts.brain}
        strategy="afterInteractive"
        data-project-key={RUNTIME_PROJECT_KEY || undefined}
        data-site-id={RUNTIME_SITE_ID || undefined}
      />
    </>
  );
}

import { Suspense } from "react";
import Script from "next/script";

import BrowserStoreBoot from "./BrowserStoreBoot";
import CavbotBadgeMotion from "./CavbotBadgeMotion";
import GlobalFooterMount from "./GlobalFooterMount";
import IconWarmup from "./IconWarmup";
import RouteLifecycle from "./RouteLifecycle";
import SystemStatusBootstrap from "@/components/status/SystemStatusBootstrap";
import { resolveCavbotAssetPolicy } from "@/lib/cavbotAssetPolicy";

const OFFICIAL_CDN_ASSETS = resolveCavbotAssetPolicy("customer_snippet");

export function AppHostPreconnectLink() {
  return <link rel="preconnect" href={OFFICIAL_CDN_ASSETS.baseUrl} crossOrigin="" />;
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
        id="cavbot-official-brain-cdn"
        src={OFFICIAL_CDN_ASSETS.scripts.brain}
        strategy="afterInteractive"
        crossOrigin="anonymous"
      />
    </>
  );
}

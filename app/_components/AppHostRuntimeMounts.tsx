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

export function AppHostPreconnectLink() {
  return null;
}

export default function AppHostRuntimeMounts() {
  return (
    <>
      <style
        id="cb-cavai-host-footer-guard"
        dangerouslySetInnerHTML={{
          __html:
            'html[data-cb-cavai-host="1"] footer[aria-label="CavBot system footer"]{display:none!important;}',
        }}
      />
      <Script id="cb-cavai-host-footer-guard-script" strategy="beforeInteractive">
        {`try{var h=location.hostname.toLowerCase();if(h==="ai.cavbot.io"||h==="cavai.cavbot.io"){document.documentElement.dataset.cbCavaiHost="1";}}catch(e){}`}
      </Script>
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
      />
      <Script
        id="cb-runtime-brain-script"
        src={INTERNAL_RUNTIME_ASSETS.scripts.brain}
        strategy="afterInteractive"
        data-project-key={RUNTIME_PROJECT_KEY || undefined}
      />
    </>
  );
}

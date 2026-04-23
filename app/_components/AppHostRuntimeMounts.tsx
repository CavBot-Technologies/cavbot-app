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
const INTERNAL_RUNTIME_ASSETS = resolveCavbotAssetPolicy("internal_runtime");
const APP_RUNTIME_PROJECT_KEY = String(process.env.NEXT_PUBLIC_CAVBOT_PROJECT_KEY || "").trim();
const APP_RUNTIME_SITE_ID = String(
  process.env.NEXT_PUBLIC_CAVBOT_SITE_PUBLIC_ID || process.env.NEXT_PUBLIC_CAVBOT_SITE_ID || "",
).trim();
const APP_RUNTIME_ANALYTICS_BOOTSTRAP = APP_RUNTIME_PROJECT_KEY
  ? `(function(){window.CAVBOT_API_URL=window.CAVBOT_API_URL||"/api/embed/analytics";window.CAVBOT_PROJECT_KEY=window.CAVBOT_PROJECT_KEY||${JSON.stringify(APP_RUNTIME_PROJECT_KEY)};${
      APP_RUNTIME_SITE_ID
        ? `window.CAVBOT_SITE_PUBLIC_ID=window.CAVBOT_SITE_PUBLIC_ID||${JSON.stringify(
            APP_RUNTIME_SITE_ID,
          )};window.CAVBOT_SITE_ID=window.CAVBOT_SITE_ID||${JSON.stringify(APP_RUNTIME_SITE_ID)};`
        : ""
    }})();`
  : null;

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
      {APP_RUNTIME_ANALYTICS_BOOTSTRAP ? (
        <Script
          id="cavbot-app-analytics-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: APP_RUNTIME_ANALYTICS_BOOTSTRAP }}
        />
      ) : null}
      {APP_RUNTIME_ANALYTICS_BOOTSTRAP ? (
        <Script
          id="cavbot-app-analytics-runtime"
          src={INTERNAL_RUNTIME_ASSETS.scripts.analytics}
          strategy="afterInteractive"
        />
      ) : null}
      <Script
        id="cavbot-official-brain-cdn"
        src={OFFICIAL_CDN_ASSETS.scripts.brain}
        strategy="afterInteractive"
        crossOrigin="anonymous"
      />
    </>
  );
}

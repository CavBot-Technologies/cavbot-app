// app/layout.tsx
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import "./globals.css";
import "./workspace.css";
import "@/components/LightToggle.css";
import CavAiBoot from "./_components/CavAiBoot";
import CavAiIntelligenceBoot from "./_components/CavAiIntelligenceBoot";
import BrowserStoreBoot from "./_components/BrowserStoreBoot";
import IconWarmup from "./_components/IconWarmup";
import GlobalFooterMount from "./_components/GlobalFooterMount";
import RouteLifecycle from "./_components/RouteLifecycle";
import SystemStatusBootstrap from "@/components/status/SystemStatusBootstrap";
import { resolveCavbotAssetPolicy } from "@/lib/cavbotAssetPolicy";

export const metadata: Metadata = {
  title: {
    default: "CavBot",
    template: "%s · CavBot",
  },
  description:
    "CavBot Console — site intelligence across SEO, performance, accessibility, UX, engagement, and events.",
};

export const viewport = {
  themeColor: "#01030f",
};

export const runtime = "nodejs";
const internalRuntimeAssets = resolveCavbotAssetPolicy("internal_runtime");
const enableRuntimeBoot = process.env.NEXT_PUBLIC_CAVBOT_RUNTIME_BOOT !== "0";
const browserStoreBootstrapScript = `(function(){function c(){var m=new Map();return{get length(){return m.size;},key:function(i){if(!Number.isFinite(i)||i<0)return null;var k=Array.from(m.keys());return k[Math.trunc(i)]||null;},getItem:function(k){var n=String(k||"");if(!n)return null;return m.has(n)?String(m.get(n)||""):null;},setItem:function(k,v){var n=String(k||"");if(!n)return;m.set(n,String(v??""));},removeItem:function(k){var n=String(k||"");if(!n)return;m.delete(n);},clear:function(){m.clear();}};}if(!globalThis.__cbLocalStore)globalThis.__cbLocalStore=c();if(!globalThis.__cbSessionStore)globalThis.__cbSessionStore=c();})();`;
const AI_ICON_PRELOADS = [
  "/icons/app/smart-optimization-svgrepo-com.svg",
  "/icons/history-svgrepo-coom.svg",
  "/icons/expand-svgrepo-com.svg",
  "/icons/x-symbol-svgrepo-com.svg",
  "/icons/app/cavcode/write-a-note-svgrepo-com.svg",
  "/icons/app/cavcode/plus-large-svgrepo-com.svg",
  "/icons/app/cavcode/3d-modelling-round-820-svgrepo-com.svg",
  "/icons/app/cavcode/brain-svgrepo-com.svg",
  "/icons/app/cavcode/arrow-up-circle-svgrepo-com.svg",
  "/icons/app/cavcode/stop-circle-svgrepo-com.svg",
  "/icons/app/microphone-svgrepo-com.svg",
  "/icons/app/sound-2-svgrepo-com.svg",
  "/icons/app/sound-max-svgrepo-com.svg",
  "/icons/copy-svgrepo-com.svg",
  "/icons/thumb-up-cavai.svg",
  "/icons/thumb-down-cavai.svg",
  "/icons/app/share-svgrepo-com.svg",
  "/icons/app/retry-svgrepo-com.svg",
  "/icons/app/deep-learning-svgrepo-com.svg",
  "/icons/app/image-combiner-svgrepo-com.svg",
  "/icons/app/image-edit-svgrepo-com.svg",
  "/icons/app/file-blank-svgrepo-com.svg",
  "/icons/app/link-svgrepo-com.svg",
  "/icons/app/workspace-svgrepo-com.svg",
] as const;

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" data-cavbot-react-app="1" style={{ backgroundColor: "#01030f" }}>
      <head>
        <script id="cb-browser-store-shim" dangerouslySetInnerHTML={{ __html: browserStoreBootstrapScript }} />
        {enableRuntimeBoot ? (
          <>
            <link id="cb-runtime-badge-inline-css" rel="stylesheet" href={internalRuntimeAssets.styles.badgeInline} />
            <link id="cb-runtime-badge-ring-css" rel="stylesheet" href={internalRuntimeAssets.styles.badgeRing} />
            <script id="cb-runtime-analytics-script" src={internalRuntimeAssets.scripts.analytics} defer />
            <script id="cb-runtime-brain-script" src={internalRuntimeAssets.scripts.brain} defer />
          </>
        ) : null}
        <link rel="preload" as="image" href="/logo/official-logotype-light.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/logo/cavbot-logomark.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/cavpad/notepad-svgrepo-com.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/app/bell-svgrepo-com.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/app/help-outline-svgrepo-com.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/app/settings-svgrepo-com.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/app/game-control-2-svgrepo-com.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/app/scroll-down-1382-svgrepo-com.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/app/scroll-up-1381-svgrepo-com.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/app/spark-svgrepo-com.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/icons/cavpad/sparkles-svgrepo-com.svg" type="image/svg+xml" />
        {AI_ICON_PRELOADS.map((href) => (
          <link key={href} rel="preload" as="image" href={href} type="image/svg+xml" />
        ))}
      </head>

      <body style={{ backgroundColor: "#01030f", color: "#c5cee7" }}>
        {/* a11y */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        {/* CavBot runtime scripts (YOU SAID THEY LIVE HERE) */}
        <Suspense fallback={null}>
          <BrowserStoreBoot />
        </Suspense>
        <Suspense fallback={null}>
          <IconWarmup />
        </Suspense>
        {enableRuntimeBoot ? (
          <>
            <Suspense fallback={null}>
              <CavAiBoot />
            </Suspense>
            <Suspense fallback={null}>
              <CavAiIntelligenceBoot />
            </Suspense>
            <Suspense fallback={null}>
              <RouteLifecycle />
            </Suspense>
            <Suspense fallback={null}>
              <SystemStatusBootstrap />
            </Suspense>
          </>
        ) : null}

        {children}
        <GlobalFooterMount />
      </body>
    </html>
  );
}

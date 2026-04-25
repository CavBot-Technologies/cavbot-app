// app/layout.tsx
import type { Metadata } from "next";
import { type ReactNode } from "react";
import { headers } from "next/headers";
import "./globals.css";
import "./workspace.css";
import "./admin-internal/admin.css";
import "@/components/LightToggle.css";
import AppHostRuntimeMounts, { AppHostPreconnectLink } from "./_components/AppHostRuntimeMounts";
import { buildClientAuthBootstrapScript, readClientAuthBootstrapServerState } from "@/lib/authClientBootstrap.server";
import { shouldRenderSharedRootRuntime } from "@/lib/admin/rootRuntime";
import { resolveRuntimeBuildStamp } from "@/lib/runtimeBuildStamp.server";

const APP_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://app.cavbot.io";

export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: {
    default: "CavBot",
    template: "%s · CavBot",
  },
  description:
    "CavBot Console — site intelligence across SEO, performance, accessibility, UX, engagement, and events.",
  manifest: "/manifest.webmanifest",
  applicationName: "CavBot",
  appleWebApp: {
    capable: true,
    title: "CavBot",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    siteName: "CavBot",
    title: "CavBot",
    description:
      "CavBot Console — site intelligence across SEO, performance, accessibility, UX, engagement, and events.",
    images: [
      { url: "/ogimage.png", alt: "CavBot" },
      { url: "/metaproperty.png", alt: "CavBot" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CavBot",
    description:
      "CavBot Console — site intelligence across SEO, performance, accessibility, UX, engagement, and events.",
    images: ["/metaproperty.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-48x48.png", type: "image/png", sizes: "48x48" },
      { url: "/favicon-64x64.png", type: "image/png", sizes: "64x64" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [
      { url: "/apple-touch-icon-120x120.png", type: "image/png", sizes: "120x120" },
      { url: "/apple-touch-icon-152x152.png", type: "image/png", sizes: "152x152" },
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
    other: [
      { rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#01030f" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#01030f",
    "msapplication-TileImage": "/mstile-144x144.png",
  },
};

export const viewport = {
  themeColor: "#01030f",
};

export const runtime = "nodejs";
const browserStoreBootstrapScript = `(function(){function c(){var m=new Map();return{get length(){return m.size;},key:function(i){if(!Number.isFinite(i)||i<0)return null;var k=Array.from(m.keys());return k[Math.trunc(i)]||null;},getItem:function(k){var n=String(k||"");if(!n)return null;return m.has(n)?String(m.get(n)||""):null;},setItem:function(k,v){var n=String(k||"");if(!n)return;m.set(n,String(v??""));},removeItem:function(k){var n=String(k||"");if(!n)return;m.delete(n);},clear:function(){m.clear();}};}function s(r){var f=c();function t(){try{return r()||null}catch{return null}}return{get length(){var o=t();if(!o)return f.length;try{return o.length}catch{return f.length}},key:function(i){var o=t();if(!o)return f.key(i);try{return o.key(i)}catch{return f.key(i)}},getItem:function(k){var n=String(k||"");if(!n)return null;var o=t();if(!o)return f.getItem(n);try{return o.getItem(n)}catch{return f.getItem(n)}},setItem:function(k,v){var n=String(k||"");if(!n)return;var o=t();if(!o){f.setItem(n,v);return}try{o.setItem(n,String(v??""))}catch{f.setItem(n,v)}},removeItem:function(k){var n=String(k||"");if(!n)return;var o=t();if(!o){f.removeItem(n);return}try{o.removeItem(n)}catch{f.removeItem(n)}},clear:function(){var o=t();if(!o){f.clear();return}try{o.clear()}catch{f.clear()}}};}if(!globalThis.__cbLocalStore)globalThis.__cbLocalStore=s(function(){return typeof window!=="undefined"?window.localStorage:null});if(!globalThis.__cbSessionStore)globalThis.__cbSessionStore=s(function(){return typeof window!=="undefined"?window.sessionStorage:null});})();`;

function buildRuntimeBuildGuardScript(buildStamp: string | null) {
  const serializedStamp = JSON.stringify(String(buildStamp || ""));
  return `(function(){try{var stamp=${serializedStamp};if(!stamp)return;var local=null;var session=null;try{local=window.localStorage||null;}catch{}try{session=window.sessionStorage||null;}catch{}if(!local)return;var stampKey="cb_runtime_build_stamp_v1";var reloadKey="cb_runtime_build_reload_v1";var prev=String(local.getItem(stampKey)||"").trim();if(!prev){local.setItem(stampKey,stamp);try{session&&session.removeItem(reloadKey);}catch{}return;}if(prev===stamp){local.setItem(stampKey,stamp);try{session&&session.removeItem(reloadKey);}catch{}return;}if(session&&String(session.getItem(reloadKey)||"").trim()===stamp){local.setItem(stampKey,stamp);return;}local.setItem(stampKey,stamp);try{session&&session.setItem(reloadKey,stamp);}catch{}var reload=function(){try{var url=new URL(window.location.href);url.searchParams.set("__cbv",stamp.slice(0,24));url.searchParams.set("__cbts",String(Date.now()));window.location.replace(url.toString());}catch{window.location.reload();}};var tasks=[];try{if("serviceWorker" in navigator){tasks.push(navigator.serviceWorker.getRegistrations().then(function(regs){return Promise.allSettled(regs.map(function(reg){return reg.unregister();}));}).catch(function(){}));}}catch{}try{if("caches" in window){tasks.push(caches.keys().then(function(keys){return Promise.allSettled(keys.map(function(key){return caches.delete(key);}));}).catch(function(){}));}}catch{}if(tasks.length){Promise.allSettled(tasks).finally(reload);return;}reload();}catch{}})();`;
}

type RootLayoutProps = {
  children: ReactNode;
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const headerStore = headers();
  const host = headerStore.get("host");
  const renderSharedRuntime = shouldRenderSharedRootRuntime(host);
  const runtimeBuildStamp = renderSharedRuntime ? resolveRuntimeBuildStamp() : null;
  const authBootstrap = renderSharedRuntime
    ? await readClientAuthBootstrapServerState()
    : { authenticated: false, session: null, profile: null, plan: null, ts: 0 };
  const authBootstrapScript = buildClientAuthBootstrapScript(authBootstrap);
  const runtimeBuildGuardScript = buildRuntimeBuildGuardScript(runtimeBuildStamp);

  return (
    <html lang="en" data-cavbot-react-app="1" style={{ backgroundColor: "#01030f" }}>
      <head>
        <script id="cb-browser-store-shim" dangerouslySetInnerHTML={{ __html: browserStoreBootstrapScript }} />
        <script id="cb-runtime-build-guard" dangerouslySetInnerHTML={{ __html: runtimeBuildGuardScript }} />
        <script id="cb-auth-bootstrap" dangerouslySetInnerHTML={{ __html: authBootstrapScript }} />
        {renderSharedRuntime ? <AppHostPreconnectLink /> : null}
      </head>

      <body style={{ backgroundColor: "#01030f", color: "#c5cee7" }}>
        {/* a11y */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        {renderSharedRuntime ? <AppHostRuntimeMounts /> : null}

        {children}
      </body>
    </html>
  );
}

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

type RootLayoutProps = {
  children: ReactNode;
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const headerStore = headers();
  const host = headerStore.get("host");
  const renderSharedRuntime = shouldRenderSharedRootRuntime(host);
  const authBootstrap = renderSharedRuntime
    ? await readClientAuthBootstrapServerState()
    : { authenticated: false, session: null, profile: null, plan: null, ts: 0 };
  const authBootstrapScript = buildClientAuthBootstrapScript(authBootstrap);

  return (
    <html lang="en" data-cavbot-react-app="1" style={{ backgroundColor: "#01030f" }}>
      <head>
        <script id="cb-browser-store-shim" dangerouslySetInnerHTML={{ __html: browserStoreBootstrapScript }} />
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

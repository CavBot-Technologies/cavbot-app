// app/layout.tsx
import type { Metadata } from "next";
import { type ReactNode } from "react";
import { headers } from "next/headers";
import "./globals.css";
import "./workspace.css";
import "./admin-internal/admin.css";
import "@/components/LightToggle.css";
import AppHostRuntimeMounts, { AppHostPreconnectLink } from "./_components/AppHostRuntimeMounts";
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
const browserStoreBootstrapScript = `(function(){function c(){var m=new Map();return{get length(){return m.size;},key:function(i){if(!Number.isFinite(i)||i<0)return null;var k=Array.from(m.keys());return k[Math.trunc(i)]||null;},getItem:function(k){var n=String(k||"");if(!n)return null;return m.has(n)?String(m.get(n)||""):null;},setItem:function(k,v){var n=String(k||"");if(!n)return;m.set(n,String(v??""));},removeItem:function(k){var n=String(k||"");if(!n)return;m.delete(n);},clear:function(){m.clear();}};}if(!globalThis.__cbLocalStore)globalThis.__cbLocalStore=c();if(!globalThis.__cbSessionStore)globalThis.__cbSessionStore=c();})();`;

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  const host = headers().get("host");
  const renderSharedRuntime = shouldRenderSharedRootRuntime(host);

  return (
    <html lang="en" data-cavbot-react-app="1" style={{ backgroundColor: "#01030f" }}>
      <head>
        <script id="cb-browser-store-shim" dangerouslySetInnerHTML={{ __html: browserStoreBootstrapScript }} />
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

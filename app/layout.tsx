// app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import appleTouchIcon120 from "@/public/favicons/apple-touch-icon-120x120.png";
import appleTouchIcon152 from "@/public/favicons/apple-touch-icon-152x152.png";
import appleTouchIcon180 from "@/public/favicons/apple-touch-icon.png";
import favicon32 from "@/public/favicons/favicon-32x32.png";
import favicon48 from "@/public/favicons/favicon-48x48.png";
import favicon64 from "@/public/favicons/favicon-64x64.png";
import favicon96 from "@/public/favicons/favicon-96x96.png";
import metapropertyImage from "@/public/favicons/metaproperty.png";
import mstile144 from "@/public/favicons/mstile-144x144.png";
import ogImage from "@/public/favicons/ogimage.png";
import safariPinnedTab from "@/public/favicons/safari-pinned-tab.svg";
import "./globals.css";
import "./workspace.css";
import "@/components/LightToggle.css";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://app.cavbot.io";
const assetUrl = (asset: { src: string } | string) => (typeof asset === "string" ? asset : asset.src);

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
      { url: assetUrl(ogImage), alt: "CavBot" },
      { url: assetUrl(metapropertyImage), alt: "CavBot" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CavBot",
    description:
      "CavBot Console — site intelligence across SEO, performance, accessibility, UX, engagement, and events.",
    images: [assetUrl(metapropertyImage)],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: assetUrl(favicon32), type: "image/png", sizes: "32x32" },
      { url: assetUrl(favicon48), type: "image/png", sizes: "48x48" },
      { url: assetUrl(favicon64), type: "image/png", sizes: "64x64" },
      { url: assetUrl(favicon96), type: "image/png", sizes: "96x96" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [
      { url: assetUrl(appleTouchIcon120), type: "image/png", sizes: "120x120" },
      { url: assetUrl(appleTouchIcon152), type: "image/png", sizes: "152x152" },
      { url: assetUrl(appleTouchIcon180), type: "image/png", sizes: "180x180" },
    ],
    other: [
      { rel: "mask-icon", url: assetUrl(safariPinnedTab), color: "#01030f" },
    ],
  },
  other: {
    "msapplication-TileColor": "#01030f",
    "msapplication-TileImage": assetUrl(mstile144),
  },
};

export const viewport = {
  themeColor: "#01030f",
};

export const runtime = "nodejs";
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

        {children}
      </body>
    </html>
  );
}

// app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./workspace.css";
import "@/components/LightToggle.css";

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

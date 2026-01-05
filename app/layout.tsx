// app/layout.tsx
import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CavBot Console",
    template: "%s · CavBot Console",
  },
  description:
    "CavBot Console — site intelligence across SEO, performance, accessibility, UX, engagement, and events.",
 }
 
export const viewport={themeColor: "#01030f",

};


export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Badge CSS lives in /public/badge (must be linked, not imported) */}
        <link rel="stylesheet" href="/cavbot/badge/cavbot-badge-inline.css" />
        
        
      </head>

      <body>
        {/* a11y */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        {/* CavBot runtime scripts (YOU SAID THEY LIVE HERE) */}
        <Script
        src="/cavbot/cavcore/cavbot-brain.js"
          strategy="afterInteractive"
        />
        <Script
          src="/cavbot/cavcore/cavcore-analytics-v5.js"
          strategy="afterInteractive"
        />

        {children}
      </body>
    </html>
  );
}
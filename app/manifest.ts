import type { MetadataRoute } from "next";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://app.cavbot.io";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CavBot",
    short_name: "CavBot",
    description:
      "CavBot Console — site intelligence across SEO, performance, accessibility, UX, engagement, and events.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#01030f",
    theme_color: "#01030f",
    id: APP_ORIGIN,
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}

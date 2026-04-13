import type { MetadataRoute } from "next";

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
    // Keep the app id same-origin on every served host so Chrome accepts the PWA identity.
    id: "/",
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

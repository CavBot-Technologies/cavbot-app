import type { MetadataRoute } from "next";
import androidChrome192 from "@/public/favicons/android-chrome-192x192.png";
import androidChrome512 from "@/public/favicons/android-chrome-512x512.png";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://app.cavbot.io";
const assetUrl = (asset: { src: string } | string) => (typeof asset === "string" ? asset : asset.src);

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
        src: assetUrl(androidChrome192),
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: assetUrl(androidChrome512),
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}

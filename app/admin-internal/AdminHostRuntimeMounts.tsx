import { Suspense } from "react";
import Script from "next/script";

import BrowserStoreBoot from "../_components/BrowserStoreBoot";
import CavAiBoot from "../_components/CavAiBoot";
import CavbotBadgeMotion from "../_components/CavbotBadgeMotion";
import GlobalFooterMount from "../_components/GlobalFooterMount";
import AdminRuntimeBrainBoot from "./AdminRuntimeBrainBoot";
import { resolveCavbotAssetPolicy } from "@/lib/cavbotAssetPolicy";

const OFFICIAL_CDN_ASSETS = resolveCavbotAssetPolicy("customer_snippet");

export default function AdminHostRuntimeMounts() {
  return (
    <>
      <Suspense fallback={null}>
        <BrowserStoreBoot />
      </Suspense>
      <Suspense fallback={null}>
        <CavbotBadgeMotion />
      </Suspense>
      <Suspense fallback={null}>
        <CavAiBoot />
      </Suspense>
      <Suspense fallback={null}>
        <GlobalFooterMount />
      </Suspense>
      <Script
        id="cavbot-official-brain-cdn-admin"
        src={OFFICIAL_CDN_ASSETS.scripts.brain}
        strategy="afterInteractive"
        crossOrigin="anonymous"
      />
      <Suspense fallback={null}>
        <AdminRuntimeBrainBoot />
      </Suspense>
    </>
  );
}

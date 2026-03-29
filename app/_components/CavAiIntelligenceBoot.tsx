"use client";

import { useEffect, useRef } from "react";
import { getCavAiIntelligenceClient } from "@/lib/cavai/intelligence.client";
import { shouldEnableRoutePerf, traceRenderCount } from "@/lib/dev/routePerf";

type WindowWithCavAiIntelligence = Window & {
  cavbotIntelligence?: ReturnType<typeof getCavAiIntelligenceClient>;
  cavai?: Record<string, unknown> & { intelligence?: ReturnType<typeof getCavAiIntelligenceClient> };
};

export default function CavAiIntelligenceBoot() {
  const renderCountRef = useRef(0);

  useEffect(() => {
    renderCountRef.current += 1;
    const client = getCavAiIntelligenceClient();
    const w = window as WindowWithCavAiIntelligence;
    w.cavbotIntelligence = client;
    w.cavai = w.cavai || {};
    w.cavai.intelligence = client;

    const perfLogging = shouldEnableRoutePerf();
    traceRenderCount("CavAiIntelligenceProvider", perfLogging, {
      renderCount: renderCountRef.current,
    });
  }, []);

  return null;
}

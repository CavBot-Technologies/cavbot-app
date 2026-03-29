// app/_cavbot/light-toggle/page.tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const AppShell = dynamic(() => import("@/components/AppShell"), { ssr: false });
const LightToggle = dynamic(() => import("@/components/LightToggle"), { ssr: false });

export const runtime = "nodejs";

export default function LightToggleLabPage() {
  const [on, setOn] = useState(false);

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="cb-console" style={{ padding: "26px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "18px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: "260px" }}>
            <h1 style={{ margin: 0, color: "rgba(247,251,255,0.92)", fontSize: 18, letterSpacing: "-0.01em" }}>
              CavBot Light Toggle (Lab)
            </h1>
            <p style={{ margin: "10px 0 0", maxWidth: 640, lineHeight: 1.5 }}>
              A contained power-state control: glass when off, CavBot blue when on, with a fast trace animation.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LightToggle
              checked={on}
              onCheckedChange={setOn}
              aria-label="Toggle power"
              title={on ? "Turn off" : "Turn on"}
              size="lg"
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontWeight: 750, color: "rgba(247,251,255,0.92)" }}>{on ? "ON" : "OFF"}</div>
              <div style={{ fontSize: 12, color: "rgba(197,206,231,0.78)" }}>Click to toggle</div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ fontSize: 12, color: "rgba(197,206,231,0.78)" }}>
            Recommended usage: “power” semantics (live mode, sound, blockers, privacy gates). For dense settings lists, keep the
            smaller switch to reduce visual noise.
          </div>
        </div>
      </div>
    </AppShell>
  );
}

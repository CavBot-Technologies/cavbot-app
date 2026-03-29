"use client";

import Image from "next/image";
import LocalTimestamp from "@/components/status/LocalTimestamp";
import { useSystemStatus } from "@/lib/hooks/useSystemStatus";
import { STATUS_UI_MAP } from "@/lib/status/ui";
import type { SystemStatusPayload } from "@/lib/system-status/types";

function heroToneClass(status: "good" | "watch" | "incident") {
  if (status === "incident") return "tone-incident";
  if (status === "watch") return "tone-watch";
  return "tone-good";
}

export default function StatusLiveOverview({
  initialData,
  pollMs = 15_000,
}: {
  initialData?: SystemStatusPayload;
  pollMs?: number;
}) {
  const { services, checkedAt, isLoading } = useSystemStatus({
    pollMs,
    fallbackData: initialData,
  });

  const hasIncident = services.some((service) => service.state === "INCIDENT");
  const hasRisk = services.some((service) => service.state === "AT_RISK");
  const hasUnknown = services.some((service) => service.state === "UNKNOWN");
  const allLive = services.length > 0 && services.every((service) => service.state === "HEALTHY") && !!checkedAt;
  const heroHeadline = hasIncident
    ? "Incident reported"
    : hasRisk
    ? "Some systems at risk"
    : allLive
    ? "All systems healthy"
    : "Checking system health…";
  const badgeToneClass = hasIncident ? "cavbot-auth-eye-error" : "";
  const heroTone = heroToneClass(hasIncident ? "incident" : hasRisk || hasUnknown ? "watch" : "good");

  return (
    <>
      <header className="status-hero">
        <div className="status-heroTop">
          <div className="status-heroLogo">
            <a href="https://cavbot.io" aria-label="Visit CavBot website">
              <Image
                src="/logo/official-logotype-light.svg"
                alt="CavBot Logo"
                width={220}
                height={60}
                priority
                unoptimized
              />
            </a>
          </div>
          <div className="status-heroBadgeRight">
            <div className="status-heroBadge" aria-label="CavBot">
              <div className={`cb-badge cb-badge-inline ${badgeToneClass}`} aria-hidden="true">
                <div className="cavbot-dm-avatar">
                  <div className="cavbot-dm-avatar-core">
                    <div className="cavbot-dm-face">
                      <div className="cavbot-eyes-row">
                        <div className="cavbot-eye">
                          <div className="cavbot-eye-inner">
                            <div className="cavbot-eye-track">
                              <div className="cavbot-eye-pupil"></div>
                            </div>
                          </div>
                          <div className="cavbot-eye-glow"></div>
                          <div className="cavbot-blink"></div>
                        </div>

                        <div className="cavbot-eye">
                          <div className="cavbot-eye-inner">
                            <div className="cavbot-eye-track">
                              <div className="cavbot-eye-pupil"></div>
                            </div>
                          </div>
                          <div className="cavbot-eye-glow"></div>
                          <div className="cavbot-blink"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="status-heroContent">
          <p className="status-heroRegion">
            Updated <LocalTimestamp value={checkedAt} fallback="Checking…" />
          </p>
          <h1 className="status-page-title">{heroHeadline}</h1>
          <div className="status-heroMeta"></div>
        </div>
      </header>
      <section className="status-grid" aria-label="Service health" data-tone={heroTone}>
        {services.map((service) => {
          const meta = STATUS_UI_MAP[service.state] || STATUS_UI_MAP.UNKNOWN;
          const latencyLabel =
            typeof service.latencyMs === "number"
              ? `${service.latencyMs} ms`
              : isLoading
              ? "Checking..."
              : "—";
          return (
            <article key={service.key} className="status-card" data-tone={service.state}>
              <div className="status-cardHead">
                <div>
                  <p className="status-cardTitle">{service.label}</p>
                </div>
                <div
                  className="status-cardBadge status-cardBadge--dotOnly"
                  aria-label={service.statusLabel}
                  role="status"
                >
                  <span className={`status-cardBadgeDot ${meta.dotClass}`} aria-hidden="true" />
                </div>
              </div>

              <div className="status-cardStats">
                <div className="status-cardStat">
                  <span className="status-cardStatLabel">Latency</span>
                  <span className="status-cardStatValue">{latencyLabel}</span>
                </div>
                <div className="status-cardStat">
                  <span className="status-cardStatLabel">Last checked</span>
                  <span className="status-cardStatValue">
                    {service.checkedAt ? (
                      <LocalTimestamp value={service.checkedAt} fallback="Checking..." />
                    ) : isLoading ? (
                      "Checking..."
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
              </div>
              {service.reason ? (
                <p className="status-cardError" aria-live="polite">
                  {service.reason}
                </p>
              ) : null}
            </article>
          );
        })}
      </section>
    </>
  );
}

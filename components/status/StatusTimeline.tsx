"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { STATUS_UI_MAP } from "@/lib/status/ui";
import type { StatusTimelineSample, StatusTimelineService } from "@/lib/status/types";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

type TimelineProps = {
  services: StatusTimelineService[];
};

type TooltipPayload = {
  id: string;
  entry: StatusTimelineSample;
  rect: DOMRect;
  serviceLabel: string;
};

function formatTimelineDay(dayKey: string) {
  const parsed = new Date(`${dayKey}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    return dayKey;
  }
  return DATE_FORMATTER.format(parsed);
}

const OPEN_DELAY = 60;
const CLOSE_DELAY = 220;

export default function StatusTimeline({ services }: TimelineProps) {
  const [tooltip, setTooltip] = useState<TooltipPayload | null>(null);
  const [portalNode, setPortalNode] = useState<HTMLDivElement | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const node = document.createElement("div");
    node.className = "status-timeline-tooltip-root";
    document.body.appendChild(node);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalNode(node);
    return () => {
      clearTimers();
      node.remove();
      setPortalNode(null);
    };
  }, [clearTimers]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinnedId(null);
        setTooltip(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const showTooltip = useCallback(
    (payload: TooltipPayload, immediate = false) => {
      clearTimers();
      if (immediate) {
        setTooltip(payload);
        return;
      }
      openTimer.current = window.setTimeout(() => {
        setTooltip(payload);
        openTimer.current = null;
      }, OPEN_DELAY);
    },
    [clearTimers]
  );

  const scheduleClose = useCallback(() => {
    if (pinnedId) return;
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      setTooltip(null);
      closeTimer.current = null;
    }, CLOSE_DELAY);
  }, [clearTimers, pinnedId]);

  const handleDotEnter = useCallback(
    (event: MouseEvent<HTMLButtonElement>, entry: StatusTimelineSample, serviceLabel: string, id: string) => {
      if (pinnedId) setPinnedId(null);
      const rect = event.currentTarget.getBoundingClientRect();
      showTooltip({ id, entry, rect, serviceLabel });
    },
    [pinnedId, showTooltip]
  );

  const handleDotLeave = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  const handleDotFocus = useCallback(
    (event: FocusEvent<HTMLButtonElement>, entry: StatusTimelineSample, serviceLabel: string, id: string) => {
      if (pinnedId) setPinnedId(null);
      const rect = event.currentTarget.getBoundingClientRect();
      showTooltip({ id, entry, rect, serviceLabel }, true);
    },
    [pinnedId, showTooltip]
  );

  const handleDotBlur = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  const handleTooltipEnter = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  const handleTooltipLeave = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  const handleDotKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, id: string, entry: StatusTimelineSample, serviceLabel: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (pinnedId === id) {
          setPinnedId(null);
          setTooltip(null);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setPinnedId(id);
        setTooltip({ id, entry, rect, serviceLabel });
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        setPinnedId(null);
        setTooltip(null);
      }
    },
    [pinnedId]
  );

  const tooltipPosition = useMemo(() => {
    if (
      !tooltip ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return null;
    }

    const { rect } = tooltip;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, 14),
      viewportWidth - 14
    );
    const preferAbove = rect.bottom + 160 > viewportHeight;
    const top = preferAbove ? rect.top - 10 : rect.bottom + 10;
    return { left, top, placement: preferAbove ? "top" : "bottom" as const };
  }, [tooltip]);

  const tooltipContent = useMemo(() => {
    if (!tooltip) return null;
    const { entry, serviceLabel } = tooltip;
    const statusInfo = STATUS_UI_MAP[entry.status];
    const dateLabel = formatTimelineDay(entry.dayKey);
    const statusLabel = statusInfo?.label ?? entry.status;
    const message = entry.message;
    return (
      <div
        className="status-tooltip"
        role="tooltip"
        data-placement={tooltipPosition?.placement ?? "bottom"}
        onMouseEnter={handleTooltipEnter}
        onMouseLeave={handleTooltipLeave}
        style={{
          left: tooltipPosition?.left ?? 0,
          top: tooltipPosition?.top ?? 0,
        }}
      >
        <div className="status-tooltipHead">
          <span className="status-tooltipDate">{dateLabel}</span>
          <span className="status-tooltipStatus">
            <span
              className="status-tooltipStatusDot"
              data-status={entry.status}
              style={{ backgroundColor: statusInfo?.color }}
              aria-hidden="true"
            />
            {statusLabel}
          </span>
        </div>
        <p className="status-tooltipMessage">{message}</p>
        {entry.component ? (
          <p className="status-tooltipMeta">
            Component · {entry.component}
          </p>
        ) : null}
        {typeof entry.durationMs === "number" ? (
          <p className="status-tooltipMeta">Latency · {entry.durationMs} ms</p>
        ) : null}
        <p className="status-tooltipMeta status-tooltipService">{serviceLabel}</p>
      </div>
    );
  }, [handleTooltipEnter, handleTooltipLeave, tooltip, tooltipPosition]);

  return (
    <>
      <div className="status-timelineList">
        {services.map((service) => (
          <div key={service.serviceKey} className="status-timelineRow">
            <div className="status-timelineLabel">
              <strong className="status-timelineService">{service.displayName}</strong>
              <span className="status-timelineUptime">
                {service.uptimePct.toFixed(1)}% healthy
              </span>
            </div>
            <div className="status-timelineTrack">
              <span className="status-timelineTrackLine" aria-hidden="true" />
              <div className="status-timelineDots" role="list">
                {service.timeline.map((entry) => {
                  const id = `${service.serviceKey}-${entry.dayKey}`;
                  const statusInfo = STATUS_UI_MAP[entry.status];
                  const dotColor =
                    entry.status === "HEALTHY"
                      ? "#00e676"
                      : entry.status === "AT_RISK"
                      ? "#ffd54a"
                      : entry.status === "INCIDENT"
                      ? "#ff3d5a"
                      : statusInfo?.color ?? "rgba(255,255,255,0.12)";
                  const dateLabel = formatTimelineDay(entry.dayKey);
                  const ariaLabel = `${service.displayName}, ${statusInfo?.label ?? entry.status}. ${dateLabel}. ${entry.message}`;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="status-timelineDot"
                      style={{ color: dotColor }}
                      data-status={entry.status}
                      aria-label={ariaLabel}
                      onMouseEnter={(event) => handleDotEnter(event, entry, service.displayName, id)}
                      onMouseLeave={handleDotLeave}
                      onFocus={(event) => handleDotFocus(event, entry, service.displayName, id)}
                      onBlur={handleDotBlur}
                      onKeyDown={(event) => handleDotKeyDown(event, id, entry, service.displayName)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      {portalNode && tooltip && createPortal(tooltipContent, portalNode)}
    </>
  );
}

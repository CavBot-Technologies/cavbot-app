import type { ServiceStatusState } from "./types";

type StatusUiConfig = {
  label: string;
  dotClass: string;
  tone?: "good" | "watch" | "bad";
  color: string;
};

export const STATUS_UI_MAP: Record<ServiceStatusState, StatusUiConfig> = {
  HEALTHY: {
    label: "Healthy",
    dotClass: "sx-status-dot-healthy",
    tone: "good",
    color: "#4ede9f",
  },
  AT_RISK: {
    label: "At risk",
    dotClass: "sx-status-dot-atrisk",
    tone: "watch",
    color: "#f2c96c",
  },
  INCIDENT: {
    label: "Incident",
    dotClass: "sx-status-dot-incident",
    tone: "bad",
    color: "#ff6b6b",
  },
  UNKNOWN: {
    label: "Unknown",
    dotClass: "sx-status-dot-unknown",
    color: "#9b9ba3",
  },
};

export const STATUS_SEQUENCE: ServiceStatusState[] = [
  "HEALTHY",
  "AT_RISK",
  "INCIDENT",
  "UNKNOWN",
];

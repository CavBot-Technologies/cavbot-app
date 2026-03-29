export type CavAiDiagSource = "typescript" | "html" | "css";

export type CavAiDiagnostic = {
  path: string;
  message: string;
  severity: "error" | "warn" | "info";
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  source: CavAiDiagSource;
  code?: number | string;
};

export type CavAiDiagnosticsRequest = {
  files?: Array<{ path: string; content: string }>;
  workspaceFiles?: Array<{ path: string; content: string }>;
  projectId?: number;
  activeFile?: string;
  reason?: string;
};

export type CavAiDiagnosticsResponse =
  | { ok: true; diagnostics: CavAiDiagnostic[] }
  | { ok: false; error: string };

export const CAVAI_DIAGNOSTICS_ENDPOINT = "/api/cavai/diagnostics";

export function normalizeDiagPath(input: string | null | undefined) {
  if (!input) return "";
  const raw = input.replace(/\\/g, "/").trim();
  if (!raw) return "";
  if (raw.startsWith("file://")) {
    return raw.replace(/^file:\/+/, "/");
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function formatDiagPathForUri(p: string) {
  const normalized = normalizeDiagPath(p);
  if (!normalized) return "";
  const trimmed = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  return `file:///${trimmed}`;
}

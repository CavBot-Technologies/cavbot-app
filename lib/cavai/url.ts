export type CavAiRouteSurface =
  | "general"
  | "workspace"
  | "console"
  | "cavcloud"
  | "cavsafe"
  | "cavpad"
  | "cavcode";

export const CAVAI_APP_PATH = "/cavai";
export const CAVAI_CANONICAL_ORIGIN = `https://app.cavbot.io${CAVAI_APP_PATH}`;

export const CAVAI_DEFAULT_SURFACE: CavAiRouteSurface = "workspace";
export const CAVAI_DEFAULT_CONTEXT_LABEL = "Workspace context";

type CavAiSearchParamsInput =
  | string
  | URLSearchParams
  | string[][]
  | Record<string, string>;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOrigin(value: string): string {
  return s(value).replace(/\/+$/, "");
}

export function normalizeCavAiSurface(value: unknown): CavAiRouteSurface {
  const raw = s(value).toLowerCase();
  if (
    raw === "general" ||
    raw === "workspace" ||
    raw === "console" ||
    raw === "cavcloud" ||
    raw === "cavsafe" ||
    raw === "cavpad" ||
    raw === "cavcode"
  ) {
    return raw;
  }
  return CAVAI_DEFAULT_SURFACE;
}

function hasScopedContext(params: URLSearchParams): boolean {
  if (s(params.get("workspaceId"))) return true;
  if (s(params.get("origin"))) return true;
  const projectId = Number(params.get("projectId"));
  return Number.isFinite(projectId) && projectId > 0;
}

export function isCavAiCanonicalHost(_hostname: string): boolean {
  void _hostname;
  return false;
}

export function buildCanonicalCavAiRootSearchParams(
  source: CavAiSearchParamsInput
): URLSearchParams {
  const params = new URLSearchParams(source);
  const surface = normalizeCavAiSurface(params.get("surface"));
  const context = s(params.get("context"));
  const scoped = hasScopedContext(params);
  const isDefaultWorkspace =
    surface === CAVAI_DEFAULT_SURFACE && (!context || context === CAVAI_DEFAULT_CONTEXT_LABEL) && !scoped;

  if (isDefaultWorkspace) {
    params.delete("surface");
    params.delete("context");
    return params;
  }

  params.set("surface", surface);
  if (context) params.set("context", context);
  else params.delete("context");
  return params;
}

export function buildCavAiPageSearchParamsFromRoot(
  source: CavAiSearchParamsInput
): URLSearchParams {
  const params = new URLSearchParams(source);
  const surface = normalizeCavAiSurface(params.get("surface"));
  params.set("surface", surface);

  if (surface === CAVAI_DEFAULT_SURFACE && !s(params.get("context")) && !hasScopedContext(params)) {
    params.set("context", CAVAI_DEFAULT_CONTEXT_LABEL);
  }

  return params;
}

export function buildCanonicalCavAiUrl(args: {
  surface: CavAiRouteSurface;
  contextLabel?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("surface", normalizeCavAiSurface(args.surface));
  if (s(args.contextLabel)) params.set("context", s(args.contextLabel));
  if (s(args.workspaceId)) params.set("workspaceId", s(args.workspaceId));
  if (Number.isFinite(Number(args.projectId)) && Number(args.projectId) > 0) {
    params.set("projectId", String(Math.trunc(Number(args.projectId))));
  }
  if (s(args.origin)) params.set("origin", s(args.origin));

  const canonicalParams = buildCanonicalCavAiRootSearchParams(params);
  const query = canonicalParams.toString();
  return `${normalizeOrigin(CAVAI_CANONICAL_ORIGIN)}${query ? `?${query}` : ""}`;
}

export function buildCanonicalCavAiUrlFromSearchParams(
  source: CavAiSearchParamsInput
): string {
  const canonicalParams = buildCanonicalCavAiRootSearchParams(source);
  const query = canonicalParams.toString();
  return `${normalizeOrigin(CAVAI_CANONICAL_ORIGIN)}${query ? `?${query}` : ""}`;
}

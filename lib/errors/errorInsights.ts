export type ErrorActionSeverity = "critical" | "high" | "medium" | "low";
export type ErrorActionImpact = "high" | "medium" | "low";
export type ErrorActionConfidence = "observed" | "inferred";

export type ErrorPrimarySurface = "js" | "api" | "404" | "stability";

export type ErrorActionScope = {
  hits: number | null;
  sessions: number | null;
  pctOfTotal: number | null; // 0..100
};

export type ErrorActionItem = {
  id: string;
  severity: ErrorActionSeverity;
  impact: ErrorActionImpact;
  title: string;
  whyItMatters: string;
  howToFix: string[]; // 3-6 bullets
  scope: ErrorActionScope;
  examples: string[]; // up to 5 fingerprints or paths
  confidence: ErrorActionConfidence;
};

export type ErrorGroupLike = {
  fingerprint: string;
  kind: string | null;
  message: string | null;
  fileName: string | null;
  routePath: string | null;
  status: number | null;
  count: number | null;
  sessions: number | null;
  firstSeenISO: string | null;
  lastSeenISO: string | null;
};

export type ErrorEventLike = {
  tsISO: string | null;
  kind: string | null;
  message: string | null;
  routePath: string | null;
  fileName: string | null;
  line: number | null;
  column: number | null;
  status: number | null;
  method: string | null;
  urlPath: string | null;
  fingerprint: string | null;
};

export type ErrorsPayloadLike = {
  updatedAtISO: string | null;
  totals: {
    jsErrors?: number | null;
    apiErrors?: number | null;
    unhandledRejections?: number | null;
    views404?: number | null;
    crashFreeSessionsPct?: number | null;
    p95DetectMs?: number | null;
  };
  trend: { day: string; jsErrors?: number | null; apiErrors?: number | null; views404?: number | null }[];
  groups: ErrorGroupLike[];
  recent: ErrorEventLike[];
};

export type EnrichedErrorGroup = ErrorGroupLike & {
  classificationHint: string | null;
  primarySurface: ErrorPrimarySurface;
  riskScore: number; // 0..100
};

export type EnrichedErrorEvent = ErrorEventLike & {
  classificationHint: string | null;
  primarySurface: ErrorPrimarySurface;
};

export type SpikeSummary = {
  jsSpike: boolean;
  apiSpike: boolean;
  views404Spike: boolean;
  notes: string[];
};

export type TopDrivers = {
  topGroupsByHits: EnrichedErrorGroup[]; // top 3
  topGroupsBySessions: EnrichedErrorGroup[]; // top 3
  top404Routes: { path: string; hits: number }[]; // top 3
  topApiEndpoints: { key: string; hits: number }[]; // top 3
};

export type DeepDiagnosis = {
  category: ErrorPrimarySurface;
  hint: string | null;
  likelySurface: ErrorPrimarySurface;
  suggestedNextStep: string[]; // 1-2 bullets
  supportingSignals: string[];
};

export type ErrorInsights = {
  spikes: SpikeSummary;
  topDrivers: TopDrivers;
  actions: ErrorActionItem[];
  groups: EnrichedErrorGroup[];
  recent: EnrichedErrorEvent[];
  rankedGroupsByHits: EnrichedErrorGroup[]; // up to 60
  rankedGroupsBySessions: EnrichedErrorGroup[]; // up to 60
  diagnosis: DeepDiagnosis | null;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function nOrNull(x: unknown): number | null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function lower(v: unknown) {
  return String(v ?? "").toLowerCase();
}

function includesAny(haystackLower: string, needles: string[]) {
  for (const needle of needles) {
    if (needle && haystackLower.includes(needle)) return true;
  }
  return false;
}

function median(values: number[]): number | null {
  const arr = values.filter((x) => Number.isFinite(x));
  if (!arr.length) return null;
  arr.sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2) return arr[mid];
  return (arr[mid - 1] + arr[mid]) / 2;
}

function pctFromCount(total: number | null | undefined, count: number | null | undefined): number | null {
  const t = typeof total === "number" && total > 0 ? total : null;
  const c = typeof count === "number" && count >= 0 ? count : null;
  if (t == null || c == null) return null;
  return clamp((c / t) * 100, 0, 100);
}

function surfaceFrom(status: number | null, kind: string | null, message: string | null): ErrorPrimarySurface {
  const s = status ?? null;
  const k = lower(kind);
  const m = lower(message);

  if (s === 404 || k.includes("404") || m.includes("not found")) return "404";
  if (k.includes("reject") || m.includes("unhandledrejection")) return "stability";
  if (k.includes("api") || m.includes("failed to fetch") || m.includes("networkerror") || (s != null && s >= 400)) return "api";
  return "js";
}

function hintFrom(status: number | null, kind: string | null, message: string | null): string | null {
  const s = status ?? null;
  const k = lower(kind);
  const m = lower(message);
  const text = `${k} ${m}`.trim();

  // Strongly supported status-based hints.
  if (s === 404) return "Broken route / missing page.";
  if (s != null && s >= 500) return "Upstream/server failure or handler exception.";

  // Deterministic string patterns.
  if (
    includesAny(text, [
      "chunkloaderror",
      "loading chunk",
      "css chunk load failed",
    ])
  )
    return "Deployment/cache mismatch (stale client assets).";

  if (includesAny(text, ["unexpected token '<'"])) return "HTML served as JS (origin/CDN misroute or fallback page).";

  if (includesAny(text, ["net::err_blocked_by_client"])) return "Request blocked by client (extension/ad blocker).";

  if (includesAny(text, ["cors"])) return "Cross-origin request blocked (CORS).";

  if (includesAny(text, ["failed to fetch", "networkerror"])) return "Network request failed (offline, DNS, blocked, or CORS).";

  if (includesAny(text, ["cannot read properties of undefined"])) return "Null/undefined access (unexpected shape or missing guard).";

  return null;
}

function isDeployMismatchHint(hint: string | null) {
  return Boolean(hint && lower(hint).includes("deployment/cache mismatch"));
}

function severityRank(s: ErrorActionSeverity) {
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "medium") return 2;
  return 1;
}
function impactRank(i: ErrorActionImpact) {
  if (i === "high") return 3;
  if (i === "medium") return 2;
  return 1;
}

function orderActions(items: ErrorActionItem[]): ErrorActionItem[] {
  return items
    .slice()
    .sort((a, b) => {
      const sa = severityRank(a.severity);
      const sb = severityRank(b.severity);
      if (sb !== sa) return sb - sa;

      const ia = impactRank(a.impact);
      const ib = impactRank(b.impact);
      if (ib !== ia) return ib - ia;

      const ha = a.scope.hits ?? 0;
      const hb = b.scope.hits ?? 0;
      if (hb !== ha) return hb - ha;

      const sa2 = a.scope.sessions ?? 0;
      const sb2 = b.scope.sessions ?? 0;
      if (sb2 !== sa2) return sb2 - sa2;

      return a.id.localeCompare(b.id);
    });
}

function computeSpikes(trend: ErrorsPayloadLike["trend"]): SpikeSummary & { baseline: { js: number | null; api: number | null; views404: number | null }; current: { js: number | null; api: number | null; views404: number | null } } {
  const points = Array.isArray(trend) ? trend : [];
  const last = points.length ? points[points.length - 1] : null;
  const prev = points.length > 1 ? points.slice(0, -1) : [];

  const absMin = { js: 10, api: 10, views404: 25 };
  const ratio = 2;

  const prevJs = prev.map((p) => nOrNull(p?.jsErrors)).filter((x): x is number => x != null && x > 0);
  const prevApi = prev.map((p) => nOrNull(p?.apiErrors)).filter((x): x is number => x != null && x > 0);
  const prev404 = prev.map((p) => nOrNull(p?.views404)).filter((x): x is number => x != null && x > 0);

  const baselineJs = median(prevJs);
  const baselineApi = median(prevApi);
  const baseline404 = median(prev404);

  const curJs = nOrNull(last?.jsErrors);
  const curApi = nOrNull(last?.apiErrors);
  const cur404 = nOrNull(last?.views404);

  const notes: string[] = [];

  const jsSpike = baselineJs != null && curJs != null ? curJs >= baselineJs * ratio && curJs >= absMin.js : false;
  const apiSpike = baselineApi != null && curApi != null ? curApi >= baselineApi * ratio && curApi >= absMin.api : false;
  const views404Spike = baseline404 != null && cur404 != null ? cur404 >= baseline404 * ratio && cur404 >= absMin.views404 : false;

  if (baselineJs == null) notes.push("JS spike baseline unavailable (insufficient non-zero history).");
  if (baselineApi == null) notes.push("API spike baseline unavailable (insufficient non-zero history).");
  if (baseline404 == null) notes.push("404 spike baseline unavailable (insufficient non-zero history).");

  if (jsSpike && curJs != null && baselineJs != null) notes.push(`JS spike: current=${curJs} baseline≈${Math.round(baselineJs)}.`);
  if (apiSpike && curApi != null && baselineApi != null) notes.push(`API spike: current=${curApi} baseline≈${Math.round(baselineApi)}.`);
  if (views404Spike && cur404 != null && baseline404 != null) notes.push(`404 spike: current=${cur404} baseline≈${Math.round(baseline404)}.`);

  return {
    jsSpike,
    apiSpike,
    views404Spike,
    notes,
    baseline: { js: baselineJs, api: baselineApi, views404: baseline404 },
    current: { js: curJs, api: curApi, views404: cur404 },
  };
}

function computeRiskScore(
  g: ErrorGroupLike,
  surfaceSpike: boolean,
  hint: string | null
): number {
  let score = 0;

  const sessions = nOrNull(g.sessions) ?? 0;
  if (sessions >= 25) score += 40;

  const status = nOrNull(g.status);
  if (status != null && status >= 500) score += 25;

  if (surfaceSpike) score += 20;

  if (isDeployMismatchHint(hint)) score += 10;

  return clamp(score, 0, 100);
}

function pickExamplesFromGroups(groups: ErrorGroupLike[], pred: (g: ErrorGroupLike) => boolean, limit = 5): string[] {
  const out: string[] = [];
  for (const g of groups) {
    if (out.length >= limit) break;
    if (!pred(g)) continue;
    const fp = String(g.fingerprint || "").trim();
    if (!fp) continue;
    out.push(fp);
  }
  return out;
}

function pickExamplesFromEvents<T extends ErrorEventLike>(events: T[], pred: (e: T) => boolean, limit = 5): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (out.length >= limit) break;
    if (!pred(e)) continue;
    const v = String(e.urlPath || e.routePath || e.fingerprint || "").trim();
    if (!v) continue;
    out.push(v);
  }
  return out;
}

function buildTopDrivers(groups: EnrichedErrorGroup[], events: EnrichedErrorEvent[]): TopDrivers {
  const byHits = groups
    .slice()
    .sort((a, b) => (nOrNull(b.count) ?? 0) - (nOrNull(a.count) ?? 0) || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, 3);

  const bySessions = groups
    .slice()
    .sort((a, b) => (nOrNull(b.sessions) ?? 0) - (nOrNull(a.sessions) ?? 0) || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, 3);

  const routeCounts = new Map<string, number>();
  for (const ev of events) {
    if (ev.primarySurface !== "404") continue;
    const path = String(ev.urlPath || ev.routePath || "").trim();
    if (!path) continue;
    routeCounts.set(path, (routeCounts.get(path) || 0) + 1);
  }
  const top404Routes = Array.from(routeCounts.entries())
    .map(([path, hits]) => ({ path, hits }))
    .sort((a, b) => b.hits - a.hits || a.path.localeCompare(b.path))
    .slice(0, 3);

  const epCounts = new Map<string, number>();
  for (const ev of events) {
    if (ev.primarySurface !== "api") continue;
    const method = String(ev.method || "").trim().toUpperCase();
    const path = String(ev.urlPath || "").trim();
    if (!method || !path) continue;
    const key = `${method} ${path}`;
    epCounts.set(key, (epCounts.get(key) || 0) + 1);
  }
  const topApiEndpoints = Array.from(epCounts.entries())
    .map(([key, hits]) => ({ key, hits }))
    .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key))
    .slice(0, 3);

  return { topGroupsByHits: byHits, topGroupsBySessions: bySessions, top404Routes, topApiEndpoints };
}

function generateActions(input: {
  payload: ErrorsPayloadLike;
  spikes: SpikeSummary;
  rankedGroupsByHits: EnrichedErrorGroup[];
  rankedGroupsBySessions: EnrichedErrorGroup[];
  recent: EnrichedErrorEvent[];
}): ErrorActionItem[] {
  const { payload, spikes, rankedGroupsByHits, rankedGroupsBySessions, recent } = input;

  const groups = rankedGroupsByHits.slice(0, 60);
  const events = recent.slice(0, 80);

  const hasTelemetry = groups.length > 0 || events.length > 0;
  if (!hasTelemetry) {
    return [
      {
        id: "waiting_for_error_telemetry",
        severity: "low",
        impact: "low",
        title: "Waiting for error telemetry",
        whyItMatters: "Error Intelligence is driven entirely by ingested client/server telemetry. No groups or events were observed in this range.",
        howToFix: [
          "Verify the CavBot instrumentation is installed on the selected target.",
          "Generate traffic and wait for ingestion to populate groups and events.",
          "Confirm the selected target matches the monitored origin/site.",
        ],
        scope: { hits: 0, sessions: 0, pctOfTotal: null },
        examples: [],
        confidence: "observed",
      },
    ];
  }

  const items: ErrorActionItem[] = [];

  const crashFree = nOrNull(payload?.totals?.crashFreeSessionsPct);
  if (crashFree != null) {
    if (crashFree < 95) {
      items.push({
        id: "crashfree_drop_critical",
        severity: "critical",
        impact: "high",
        title: "Crash-free sessions below 95%",
        whyItMatters: "Stability is materially degraded. This is typically correlated with user-visible failures and session abandonment.",
        howToFix: [
          "Identify the top group(s) by sessions affected and start there.",
          "Look for deploy/cache mismatch or network failures that amplify across sessions.",
          "Verify releases, feature flags, and recent client changes in the selected range.",
        ],
        scope: { hits: null, sessions: null, pctOfTotal: crashFree },
        examples: pickExamplesFromGroups(groups, (g) => (g.sessions ?? 0) >= 25, 5),
        confidence: "observed",
      });
    } else if (crashFree < 99) {
      items.push({
        id: "crashfree_drop_high",
        severity: "high",
        impact: "high",
        title: "Crash-free sessions trending low",
        whyItMatters: "A sustained stability dip increases support load and reduces conversion reliability.",
        howToFix: [
          "Prioritize groups by sessions affected (not just hits).",
          "Check for regressions introduced by recent deploys in this window.",
          "Verify client error boundaries and guardrails around undefined/null data.",
        ],
        scope: { hits: null, sessions: null, pctOfTotal: crashFree },
        examples: pickExamplesFromGroups(rankedGroupsBySessions, (g) => (g.sessions ?? 0) >= 10, 5),
        confidence: "observed",
      });
    }
  }

  const top = groups[0] || null;
  const totalHits = groups.reduce((acc, g) => acc + (nOrNull(g.count) ?? 0), 0);
  if (top && (nOrNull(top.count) ?? 0) > 0 && totalHits > 0) {
    const share = ((nOrNull(top.count) ?? 0) / totalHits) * 100;
    if (share >= 50 && (nOrNull(top.count) ?? 0) >= 20) {
      items.push({
        id: "dominant_group_high_share",
        severity: "high",
        impact: "high",
        title: "A single error group dominates volume",
        whyItMatters: "When one signature drives most errors, fixing it typically yields the fastest stability win.",
        howToFix: [
          "Open Deep Read and identify the route/file/status chips for the dominant signature.",
          "Reproduce the error in a controlled environment using the same route/path.",
          "Ship a targeted fix and validate volume drops on the next ingest window.",
        ],
        scope: {
          hits: nOrNull(top.count),
          sessions: nOrNull(top.sessions),
          pctOfTotal: pctFromCount(totalHits, nOrNull(top.count)),
        },
        examples: [top.fingerprint].filter(Boolean).slice(0, 5),
        confidence: "observed",
      });
    }
  }

  const api5xxCount = events.filter((e) => (nOrNull(e.status) ?? 0) >= 500).length;
  if (spikes.apiSpike || api5xxCount >= 5) {
    items.push({
      id: "api_5xx_spike",
      severity: api5xxCount >= 10 ? "critical" : "high",
      impact: "high",
      title: "API error pressure elevated",
      whyItMatters: "Server-side error responses degrade user flows and can cascade into client retries and timeouts.",
      howToFix: [
        "Inspect the top API endpoints by frequency and correlate with status codes.",
        "Check upstream dependencies, timeouts, and recent handler changes.",
        "Validate that error responses are not being cached or served broadly by a CDN.",
      ],
      scope: { hits: api5xxCount || null, sessions: null, pctOfTotal: null },
      examples: pickExamplesFromEvents(events, (e) => (nOrNull(e.status) ?? 0) >= 500, 5),
      confidence: spikes.apiSpike ? "inferred" : "observed",
    });
  }

  const views404Count = events.filter((e) => (nOrNull(e.status) ?? 0) === 404 || e.primarySurface === "404").length;
  if (spikes.views404Spike || views404Count >= 8) {
    items.push({
      id: "404_route_spike",
      severity: views404Count >= 20 ? "high" : "medium",
      impact: "medium",
      title: "404 volume elevated",
      whyItMatters: "Broken routes harm recovery posture and create dead ends for users and bots.",
      howToFix: [
        "Identify the top missing paths and confirm expected routing behavior.",
        "Add redirects or restore removed pages where appropriate.",
        "Check deploy routing rules and CDN rewrite configuration.",
      ],
      scope: { hits: views404Count || null, sessions: null, pctOfTotal: null },
      examples: pickExamplesFromEvents(events, (e) => (nOrNull(e.status) ?? 0) === 404 || e.primarySurface === "404", 5),
      confidence: spikes.views404Spike ? "inferred" : "observed",
    });
  }

  const chunkMismatchGroups = groups.filter((g) => isDeployMismatchHint(g.classificationHint));
  if (chunkMismatchGroups.length) {
    items.push({
      id: "deploy_cache_mismatch",
      severity: "high",
      impact: "high",
      title: "Client assets mismatch (chunk load failures)",
      whyItMatters: "Chunk load errors typically spike after deploys and can break navigation for returning users with stale caches.",
      howToFix: [
        "Verify CDN and browser caching rules for JS/CSS assets (hashing + immutable).",
        "Ensure old assets remain available during rollout to prevent 404 on chunks.",
        "Consider a service-worker or cache-busting strategy if applicable.",
      ],
      scope: { hits: null, sessions: null, pctOfTotal: null },
      examples: pickExamplesFromGroups(chunkMismatchGroups, () => true, 5),
      confidence: "observed",
    });
  }

  const unhandled = groups.filter((g) => includesAny(lower(g.kind) + " " + lower(g.message), ["unhandledrejection", "rejected promise"]));
  if (unhandled.length) {
    items.push({
      id: "unhandled_rejection_recurring",
      severity: "medium",
      impact: "medium",
      title: "Unhandled promise rejections recurring",
      whyItMatters: "Unhandled rejections often indicate missing error handling for network and parsing failures, which can destabilize flows.",
      howToFix: [
        "Add explicit `catch` handlers around critical async boundaries.",
        "Harden response parsing and null/undefined guards before property access.",
        "Log and surface request context (endpoint/path) when failures occur.",
      ],
      scope: { hits: null, sessions: null, pctOfTotal: null },
      examples: pickExamplesFromGroups(unhandled, () => true, 5),
      confidence: "observed",
    });
  }

  // Stable fallback: ensure there is at least one operational action.
  if (!items.length && top) {
    items.push({
      id: "investigate_top_group",
      severity: top.riskScore >= 60 ? "high" : top.riskScore >= 30 ? "medium" : "low",
      impact: "medium",
      title: "Investigate the top error group",
      whyItMatters: "The highest-volume signature is the most direct lever for lowering overall error pressure.",
      howToFix: [
        "Use Deep Read to capture the fingerprint, route/file, and status context.",
        "Reproduce and validate the same signature locally or in staging.",
        "Ship a targeted fix and confirm the signature volume declines.",
      ],
      scope: { hits: nOrNull(top.count), sessions: nOrNull(top.sessions), pctOfTotal: pctFromCount(totalHits, nOrNull(top.count)) },
      examples: [top.fingerprint].filter(Boolean).slice(0, 5),
      confidence: "observed",
    });
  }

  return orderActions(items).slice(0, 8);
}

function buildDiagnosis(
  selected: EnrichedErrorGroup | null,
  spikes: SpikeSummary
): DeepDiagnosis | null {
  if (!selected) return null;

  const signals: string[] = [];
  if (selected.status != null) signals.push(`HTTP ${selected.status}`);
  if (selected.routePath) signals.push(`route=${selected.routePath}`);
  if (selected.fileName) signals.push(`file=${selected.fileName}`);
  if (selected.lastSeenISO) signals.push(`lastSeen=${selected.lastSeenISO}`);
  if (selected.sessions != null) signals.push(`sessions=${selected.sessions}`);
  if (selected.count != null) signals.push(`hits=${selected.count}`);
  if (selected.classificationHint) signals.push(`hint=${selected.classificationHint}`);
  if (selected.primarySurface === "js" && spikes.jsSpike) signals.push("jsSpike=true");
  if (selected.primarySurface === "api" && spikes.apiSpike) signals.push("apiSpike=true");
  if (selected.primarySurface === "404" && spikes.views404Spike) signals.push("views404Spike=true");

  const next: string[] = [];
  if (selected.primarySurface === "404") {
    next.push("Confirm the path is expected and add a redirect or restore the missing route.");
  } else if (selected.primarySurface === "api") {
    next.push("Check the endpoint handler and upstream dependency health for the same status/signature.");
  } else if (isDeployMismatchHint(selected.classificationHint)) {
    next.push("Validate asset caching and ensure old chunks remain available during deploy rollout.");
  } else {
    next.push("Reproduce the signature and add guards around undefined/null and parsing boundaries.");
  }

  return {
    category: selected.primarySurface,
    hint: selected.classificationHint,
    likelySurface: selected.primarySurface,
    suggestedNextStep: next.slice(0, 2),
    supportingSignals: signals.slice(0, 12),
  };
}

export function buildErrorInsights(
  payload: ErrorsPayloadLike,
  opts?: { selectedFingerprint?: string }
): ErrorInsights {
  const groupsRaw = Array.isArray(payload?.groups) ? payload.groups : [];
  const eventsRaw = Array.isArray(payload?.recent) ? payload.recent : [];

  const spikesAll = computeSpikes(payload?.trend || []);
  const spikes: SpikeSummary = {
    jsSpike: spikesAll.jsSpike,
    apiSpike: spikesAll.apiSpike,
    views404Spike: spikesAll.views404Spike,
    notes: spikesAll.notes,
  };

  // Enrich without reordering. Limit analysis scope as required.
  const groupsLimited = groupsRaw.slice(0, 60);
  const eventsLimited = eventsRaw.slice(0, 80);

  const enrichedGroups: EnrichedErrorGroup[] = groupsLimited.map((g) => {
    const hint = hintFrom(nOrNull(g.status), g.kind, g.message);
    const surface = surfaceFrom(nOrNull(g.status), g.kind, g.message);
    const surfaceSpike =
      (surface === "js" && spikes.jsSpike) ||
      (surface === "api" && spikes.apiSpike) ||
      (surface === "404" && spikes.views404Spike) ||
      false;

    return {
      ...g,
      classificationHint: hint,
      primarySurface: surface,
      riskScore: computeRiskScore(g, surfaceSpike, hint),
    };
  });

  const enrichedEvents: EnrichedErrorEvent[] = eventsLimited.map((ev) => {
    const hint = hintFrom(nOrNull(ev.status), ev.kind, ev.message);
    const surface = surfaceFrom(nOrNull(ev.status), ev.kind, ev.message);
    return { ...ev, classificationHint: hint, primarySurface: surface };
  });

  const rankedGroupsByHits = enrichedGroups
    .slice()
    .sort((a, b) => (nOrNull(b.count) ?? 0) - (nOrNull(a.count) ?? 0) || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, 60);

  const rankedGroupsBySessions = enrichedGroups
    .slice()
    .sort((a, b) => (nOrNull(b.sessions) ?? 0) - (nOrNull(a.sessions) ?? 0) || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, 60);

  const topDrivers = buildTopDrivers(enrichedGroups, enrichedEvents);

  const actions = generateActions({
    payload,
    spikes,
    rankedGroupsByHits,
    rankedGroupsBySessions,
    recent: enrichedEvents,
  });

  const selectedFp = String(opts?.selectedFingerprint || "").trim();
  const selected = selectedFp ? enrichedGroups.find((g) => g.fingerprint === selectedFp) || null : null;
  const diagnosis = buildDiagnosis(selected, spikes);

  return {
    spikes,
    topDrivers,
    actions,
    groups: enrichedGroups,
    recent: enrichedEvents,
    rankedGroupsByHits,
    rankedGroupsBySessions,
    diagnosis,
  };
}

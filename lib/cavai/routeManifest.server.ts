import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { listCavAiPageContextAdapters, resolveCavAiRouteAwareness, type CavAiPageCategory } from "@/lib/cavai/pageAwareness";

export const CAVAI_ROUTE_MANIFEST_VERSION = "route_manifest_v1";

export type CavAiRouteManifestRow = {
  route: string;
  pageFile: string;
  adapterId: string;
  category: CavAiPageCategory;
  surface: string;
  contextLabel: string;
  confidence: "exact" | "prefix" | "heuristic";
  coverage: "covered" | "heuristic";
  tools: string[];
  memoryScopes: string[];
};

export type CavAiRouteManifestSnapshotPayload = {
  version: string;
  generatedAt: string;
  appRoot: string;
  adapterCount: number;
  routeCount: number;
  coveredCount: number;
  heuristicCount: number;
  uncoveredCount: number;
  adapterCoverageRate: number;
  categories: Record<string, number>;
  surfaces: Record<string, number>;
  routes: CavAiRouteManifestRow[];
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function isPageFile(fileName: string): boolean {
  return /^page\.(tsx|ts|jsx|js|mdx)$/i.test(fileName);
}

function shouldSkipDirectory(name: string): boolean {
  const value = s(name);
  if (!value) return true;
  if (value === "api") return true;
  return false;
}

function isRouteGroupSegment(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function isParallelSegment(segment: string): boolean {
  return segment.startsWith("@");
}

function normalizeRouteSegment(segment: string): string | null {
  const value = s(segment);
  if (!value) return null;
  if (isRouteGroupSegment(value)) return null;
  if (isParallelSegment(value)) return null;
  return value;
}

function toRouteFromRelativePagePath(relativeFilePath: string): string {
  const normalized = relativeFilePath.replace(/\\/g, "/");
  const withoutPageFile = normalized.replace(/\/page\.(tsx|ts|jsx|js|mdx)$/i, "");
  const rawSegments = withoutPageFile.split("/").map((part) => part.trim()).filter(Boolean);
  const routeSegments = rawSegments
    .map((segment) => normalizeRouteSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  if (!routeSegments.length) return "/";
  return `/${routeSegments.join("/")}`;
}

async function collectPageFiles(dirAbs: string, relativeDir = ""): Promise<string[]> {
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  const out: string[] = [];

  for (const entry of entries) {
    const nextRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const nextAbs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      const nested = await collectPageFiles(nextAbs, nextRelative);
      out.push(...nested);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isPageFile(entry.name)) continue;
    out.push(nextRelative.replace(/\\/g, "/"));
  }

  return out;
}

function toCountMap(values: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const value of values) {
    const key = s(value).toLowerCase() || "unknown";
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

function toCoverageRate(coveredCount: number, routeCount: number): number {
  if (!Number.isFinite(routeCount) || routeCount <= 0) return 0;
  const value = (Math.max(0, coveredCount) / routeCount) * 100;
  return Number(value.toFixed(2));
}

export async function buildCavAiRouteManifestSnapshot(args?: {
  appRootAbs?: string;
}): Promise<CavAiRouteManifestSnapshotPayload> {
  const appRoot = s(args?.appRootAbs) || path.resolve(process.cwd(), "app");
  const files = await collectPageFiles(appRoot);
  const adapters = listCavAiPageContextAdapters();

  const rows: CavAiRouteManifestRow[] = files
    .map((file) => {
      const route = toRouteFromRelativePagePath(file);
      const awareness = resolveCavAiRouteAwareness({ pathname: route });
      const coverage: CavAiRouteManifestRow["coverage"] = awareness.confidence === "heuristic" ? "heuristic" : "covered";
      return {
        route,
        pageFile: `/app/${file}`,
        adapterId: awareness.adapterId,
        category: awareness.routeCategory,
        surface: awareness.surface,
        contextLabel: awareness.contextLabel,
        confidence: awareness.confidence,
        coverage,
        tools: awareness.tools,
        memoryScopes: awareness.memoryScopes,
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route));

  const routeCount = rows.length;
  const coveredCount = rows.filter((row) => row.coverage === "covered").length;
  const heuristicCount = rows.filter((row) => row.coverage === "heuristic").length;
  const uncoveredCount = heuristicCount;
  const adapterCoverageRate = toCoverageRate(coveredCount, routeCount);

  return {
    version: CAVAI_ROUTE_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    appRoot,
    adapterCount: adapters.length,
    routeCount,
    coveredCount,
    heuristicCount,
    uncoveredCount,
    adapterCoverageRate,
    categories: toCountMap(rows.map((row) => row.category)),
    surfaces: toCountMap(rows.map((row) => row.surface)),
    routes: rows,
  };
}

export async function persistCavAiRouteManifestSnapshot(args: {
  accountId: string;
  userId: string;
  requestId: string;
  source?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  snapshot: CavAiRouteManifestSnapshotPayload;
}): Promise<{ id: string }> {
  const snapshot = args.snapshot;
  const created = await prisma.cavAiRouteManifestSnapshot.create({
    data: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      requestId: s(args.requestId).slice(0, 120),
      source: s(args.source) || "route_manifest_scan",
      workspaceId: s(args.workspaceId) || null,
      projectId: toProjectId(args.projectId),
      origin: s(args.origin) || null,
      manifestVersion: snapshot.version,
      routeCount: snapshot.routeCount,
      coveredCount: snapshot.coveredCount,
      heuristicCount: snapshot.heuristicCount,
      uncoveredCount: snapshot.uncoveredCount,
      adapterCoverageRate: snapshot.adapterCoverageRate,
      manifestJson: snapshot as unknown as object,
      coverageJson: {
        categories: snapshot.categories,
        surfaces: snapshot.surfaces,
      } as unknown as object,
    },
    select: { id: true },
  });
  return created;
}

export type CavAiRouteManifestSnapshotSummary = {
  id: string;
  createdAt: string;
  manifestVersion: string;
  routeCount: number;
  coveredCount: number;
  heuristicCount: number;
  uncoveredCount: number;
  adapterCoverageRate: number;
  workspaceId: string | null;
  projectId: number | null;
  origin: string | null;
  source: string;
};

export async function listCavAiRouteManifestSnapshots(args: {
  accountId: string;
  workspaceId?: string | null;
  projectId?: number | null;
  limit?: number;
}): Promise<CavAiRouteManifestSnapshotSummary[]> {
  const limit = Math.max(1, Math.min(40, Math.trunc(Number(args.limit || 12))));
  const rows = await prisma.cavAiRouteManifestSnapshot.findMany({
    where: {
      accountId: s(args.accountId),
      ...(s(args.workspaceId) ? { workspaceId: s(args.workspaceId) } : {}),
      ...(toProjectId(args.projectId) ? { projectId: toProjectId(args.projectId) } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      manifestVersion: true,
      routeCount: true,
      coveredCount: true,
      heuristicCount: true,
      uncoveredCount: true,
      adapterCoverageRate: true,
      workspaceId: true,
      projectId: true,
      origin: true,
      source: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    manifestVersion: row.manifestVersion,
    routeCount: row.routeCount,
    coveredCount: row.coveredCount,
    heuristicCount: row.heuristicCount,
    uncoveredCount: row.uncoveredCount,
    adapterCoverageRate: Number(row.adapterCoverageRate || 0),
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    origin: row.origin,
    source: row.source,
  }));
}

export async function getCavAiRouteManifestSnapshot(args: {
  accountId: string;
  snapshotId: string;
}): Promise<CavAiRouteManifestSnapshotPayload | null> {
  const row = await prisma.cavAiRouteManifestSnapshot.findFirst({
    where: {
      id: s(args.snapshotId),
      accountId: s(args.accountId),
    },
    select: { manifestJson: true },
  });
  if (!row?.manifestJson || typeof row.manifestJson !== "object" || Array.isArray(row.manifestJson)) return null;
  return row.manifestJson as unknown as CavAiRouteManifestSnapshotPayload;
}

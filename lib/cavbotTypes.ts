export type CavBotMetricMap = Record<string, unknown>;

export type CavBotSite = {
  id: string;
  label: string;
  origin: string; // origin only, not full path
  isActive?: boolean;
};

// Geo Intelligence (future rollups)
// NOTE: country/region/city are coarse. Avoid storing precise lat/lon unless  we have explicit consent + need.
export type CavBotGeoRow = {
  country?: string;        // e.g. "US"
  countryName?: string;    // map server-side
  region?: string;         // e.g. "CA"
  regionName?: string;
  city?: string;

  // Aggregates (Worker can emit any subset)
  pageViews?: number;
  sessions?: number;
  uniqueVisitors?: number;
  routesAffected?: number;

  // Optional for ops debugging
  colo?: string;           // Cloudflare colo code (edge POP), not user identity
};

export type CavBotGeoBreakdown = {
  countries?: CavBotGeoRow[];
  regions?: CavBotGeoRow[];
  cities?: CavBotGeoRow[];
};

export interface ProjectSummary {
  project: {
    id: string;
    key?: string;
    name?: string;
    projectId?: number;
    projectKeyId?: number;
  };
  window: {
    range: string;
    from?: string;
    to?: string;
  };
  sites?: CavBotSite[];
  activeSite?: CavBotSite;

  // Existing: CavBot keeps returning the same object we return today
  metrics: CavBotMetricMap;

  // Optional envelopes returned by some summary endpoints/versions.
  // Pages may prefer these over the whole response when embedding JSON context.
  snapshot?: unknown;
  diagnostics?: unknown;

  geo?: CavBotGeoBreakdown;
}

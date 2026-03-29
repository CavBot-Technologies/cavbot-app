type RegionInput = {
  region?: string;
  name?: string;
  label?: string;
  sharePct?: number | string;
  share?: number | string;
  pct?: number | string;
  signal24h?: number | string;
  signal?: number | string;
  scans24h?: number | string;
  count24h?: number | string;
  countries?: CountryInput[];
};

type CountryInput = {
  country?: string;
  name?: string;
  code?: string;
  sharePct?: number | string;
  share?: number | string;
  pct?: number | string;
  signal24h?: number | string;
  signal?: number | string;
  scans24h?: number | string;
  count24h?: number | string;
};

type GeoRaw = {
  mode?: "range" | string;
  updatedAtISO?: string;
  updatedAt?: string;
  regions?: RegionInput[];
  topRegions?: RegionInput[];
  totalSignal24h?: number | string;
  total24h?: number | string;
  totalSignals24h?: number | string;
  totalScansRange?: number | string;
  totalScans?: number | string;
  total?: number | string;
};

type RegionNormalized = {
  region: string;
  sharePct: number;
  signal24h: number;
  countries: {
    country: string;
    sharePct: number;
    signal24h: number;
  }[];
};

type GeoNormalized = {
  mode: "live" | "range";
  updatedAtISO: string;
  totalSignal24h: number;
  totalScansRange: number;
  regions: RegionNormalized[];
};

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const toPercent = (value: unknown): number => {
  let pct = toNumber(value);
  if (pct <= 1) pct = pct * 100;
  if (pct > 100) pct = 100;
  if (pct < 0) pct = 0;
  return pct;
};

const toString = (value: unknown, fallback = "Unknown") =>
  typeof value === "string" ? value : value == null ? fallback : String(value);

export function normalizeGeo(raw?: GeoRaw | null): GeoNormalized {
  const mode = raw?.mode === "range" ? "range" : "live";
  const updatedAtISO =
    typeof raw?.updatedAtISO === "string"
      ? raw.updatedAtISO
      : typeof raw?.updatedAt === "string"
      ? raw.updatedAt
      : "";

  const regionsSource = Array.isArray(raw?.regions)
    ? raw.regions
    : Array.isArray(raw?.topRegions)
    ? raw.topRegions
    : [];

  const regions = regionsSource.map<RegionNormalized>((region) => ({
    region: toString(region.region ?? region.name ?? region.label),
    sharePct: toPercent(region.sharePct ?? region.share ?? region.pct),
    signal24h: toNumber(region.signal24h ?? region.signal ?? region.scans24h ?? region.count24h),
    countries: Array.isArray(region.countries)
      ? region.countries.map((country) => ({
          country: toString(country.country ?? country.name ?? country.code),
          sharePct: toPercent(country.sharePct ?? country.share ?? country.pct),
          signal24h: toNumber(country.signal24h ?? country.signal ?? country.scans24h ?? country.count24h),
        }))
      : [],
  }));

  return {
    mode,
    updatedAtISO,
    totalSignal24h: toNumber(raw?.totalSignal24h ?? raw?.total24h ?? raw?.totalSignals24h),
    totalScansRange: toNumber(raw?.totalScansRange ?? raw?.totalScans ?? raw?.total),
    regions,
  };
}

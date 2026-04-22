import "server-only";

type HeaderGetter = Pick<Headers, "get">;
type HeaderSource = HeaderGetter | { headers: HeaderGetter };

export type RequestGeo = {
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: string | null;
  longitude: string | null;
  ip: string | null;
  label: string | null;
};

function safeStr(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function resolveHeaders(source: HeaderSource): HeaderGetter {
  return "get" in source ? source : source.headers;
}

export function pickHeader(source: HeaderSource, names: string[]) {
  const headers = resolveHeaders(source);
  for (const name of names) {
    const value = safeStr(headers.get(name)).trim();
    if (value) return value;
  }
  return "";
}

function readCoordinate(raw: unknown, kind: "lat" | "lon") {
  const value = safeStr(raw).trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (kind === "lat" && (parsed < -90 || parsed > 90)) return null;
  if (kind === "lon" && (parsed < -180 || parsed > 180)) return null;
  return parsed.toFixed(4);
}

export function composeLocationLabel(args: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  ip?: string | null;
}) {
  const city = safeStr(args.city).trim();
  const region = safeStr(args.region).trim();
  const country = safeStr(args.country).trim();
  const latitude = safeStr(args.latitude).trim();
  const longitude = safeStr(args.longitude).trim();
  const ip = safeStr(args.ip).trim();

  const placeParts = [city, region, country].filter(Boolean);
  if (placeParts.length) {
    if (latitude && longitude) {
      return `${placeParts.join(", ")} · ${latitude}, ${longitude}`;
    }
    return placeParts.join(", ");
  }

  if (latitude && longitude) {
    return `Lat ${latitude}, Lon ${longitude}`;
  }

  if (ip) {
    return `Approximate network location (IP ${ip})`;
  }

  return "Approximate network location";
}

export function pickClientIp(source: HeaderSource) {
  const cfConn = pickHeader(source, ["cf-connecting-ip"]);
  if (cfConn) return cfConn;

  const trueClientIp = pickHeader(source, ["true-client-ip"]);
  if (trueClientIp) return trueClientIp;

  const forwarded = pickHeader(source, ["x-forwarded-for"]);
  if (forwarded) return forwarded.split(",")[0]?.trim() || "";

  const realIp = pickHeader(source, ["x-real-ip"]);
  if (realIp) return realIp;

  return "";
}

export function readRequestGeo(source: HeaderSource): RequestGeo {
  const ip = pickClientIp(source) || null;
  const city = pickHeader(source, ["cf-ipcity", "x-vercel-ip-city", "x-appengine-city", "x-geo-city"]) || null;
  const region =
    pickHeader(source, [
      "cf-region",
      "cf-region-code",
      "x-vercel-ip-country-region",
      "x-appengine-region",
      "x-geo-region",
    ]) || null;

  const countryRaw = pickHeader(source, ["cf-ipcountry", "x-vercel-ip-country", "x-appengine-country", "x-geo-country"]);
  const country = countryRaw && countryRaw !== "XX" ? countryRaw : null;

  const latitude = readCoordinate(
    pickHeader(source, ["cf-iplatitude", "x-vercel-ip-latitude", "x-geo-latitude", "x-latitude"]),
    "lat",
  );
  const longitude = readCoordinate(
    pickHeader(source, ["cf-iplongitude", "x-vercel-ip-longitude", "x-geo-longitude", "x-longitude"]),
    "lon",
  );

  const label = composeLocationLabel({ city, region, country, latitude, longitude, ip });
  return {
    city,
    region,
    country,
    latitude,
    longitude,
    ip,
    label: label || null,
  };
}

export function readCoarseRequestGeo(source: HeaderSource) {
  const geo = readRequestGeo(source);
  return {
    country: geo.country,
    region: geo.region,
    label: geo.label,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readGeoFromMeta(metaJson: unknown) {
  const meta = isRecord(metaJson) ? metaJson : {};

  const direct = [
    meta.location,
    meta.geoLabel,
    meta.geo,
    meta.city,
    meta.region,
    meta.country,
  ]
    .map((value) => safeStr(value).trim())
    .find(Boolean);

  const city = safeStr(meta.geoCity ?? meta.city).trim() || null;
  const region = safeStr(meta.geoRegion ?? meta.region ?? meta.regionCode).trim() || null;
  const countryRaw = safeStr(meta.geoCountry ?? meta.country ?? meta.countryCode).trim();
  const country = countryRaw && countryRaw !== "XX" ? countryRaw : null;
  const latitude = readCoordinate(meta.geoLatitude ?? meta.latitude ?? meta.lat ?? meta.geoLat, "lat");
  const longitude = readCoordinate(meta.geoLongitude ?? meta.longitude ?? meta.lng ?? meta.lon ?? meta.geoLon, "lon");
  const label = direct || composeLocationLabel({ city, region, country, latitude, longitude });

  return {
    city,
    region,
    country,
    latitude,
    longitude,
    label: label || null,
  };
}

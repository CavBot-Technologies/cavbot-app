import type { ArcadeLockMap } from "@/lib/billing/arcadeGates";

export const ARCADE_KIND_404 = "404";
const ARCADE_CDN_BASE = "https://cdn.cavbot.io";
const LOCAL_ARCADE_ASSET_BASE = "/cavbot-arcade";
const LIVE_MODE_FLAG = (process.env.NEXT_PUBLIC_CAVBOT_LIVE_MODE || "")
  .trim()
  .toLowerCase();
const IS_LIVE_MODE = process.env.NODE_ENV === "production" || LIVE_MODE_FLAG === "1" || LIVE_MODE_FLAG === "true";

const LOCAL_404_THUMBNAIL_BY_SLUG: Record<string, string> = {
  "catch-cavbot": "/cavbot-arcade/demo/thumbnails/catch-cavbot-thumbnail.png",
  "tennis-cavbot": "/cavbot-arcade/demo/thumbnails/cavbot-tennis-thumbnail.png",
  "futbol-cavbot": "/cavbot-arcade/demo/thumbnails/cavbot-fc-thumbnail.png",
  "cavbot-imposter": "/cavbot-arcade/demo/thumbnails/cavbot-imposter-thumbnail.png",
  "cavbot-signal-chase": "/cavbot-arcade/demo/thumbnails/cavbot-signal-chase-thumbnail.png",
  "cavbot-cache-sweep": "/cavbot-arcade/demo/thumbnails/cavbot-cache-sweep-thumbnail.png",
};

export type ArcadeGameSummary = {
  slug: string;
  version: string;
  displayName: string;
  thumbnailUrl: string;
};

export type SiteArcadeOptions = {
  sound: boolean;
  difficulty: "easy" | "standard" | "hard";
  theme: "dark" | "light" | "auto";
  redirectUrl: string;
  supportEmail: string;
};

export const DEFAULT_ARCADE_OPTIONS: SiteArcadeOptions = {
  sound: true,
  difficulty: "standard",
  theme: "dark",
  redirectUrl: "",
  supportEmail: "",
};

export type ArcadeConfigPayload = {
  siteId: string;
  enabled: boolean;
  gameSlug: string | null;
  gameVersion: string | null;
  options: SiteArcadeOptions;
  updatedAt: string;
};

export type ArcadeConfigResponse = {
  ok: true;
  config: ArcadeConfigPayload | null;
  games: ArcadeGameSummary[];
  allowedGames: string[];
  lockMap: ArcadeLockMap;
};

export function mergeArcadeOptions(value?: Partial<SiteArcadeOptions>): SiteArcadeOptions {
  if (!value) return DEFAULT_ARCADE_OPTIONS;
  return {
    sound: typeof value.sound === "boolean" ? value.sound : DEFAULT_ARCADE_OPTIONS.sound,
    difficulty:
      value.difficulty && ["easy", "standard", "hard"].includes(value.difficulty)
        ? value.difficulty
        : DEFAULT_ARCADE_OPTIONS.difficulty,
    theme:
      value.theme && ["dark", "light", "auto"].includes(value.theme)
        ? value.theme
        : DEFAULT_ARCADE_OPTIONS.theme,
    redirectUrl:
      typeof value.redirectUrl === "string" ? value.redirectUrl.trim() : DEFAULT_ARCADE_OPTIONS.redirectUrl,
    supportEmail:
      typeof value.supportEmail === "string" ? value.supportEmail.trim() : DEFAULT_ARCADE_OPTIONS.supportEmail,
  };
}

export function buildArcadeThumbnailUrl(slug: string, version: string): string {
  const safeVersion = version || "v1";
  if (IS_LIVE_MODE) {
    return `${ARCADE_CDN_BASE}/arcade/${ARCADE_KIND_404}/${slug}/${safeVersion}/files/assets/thumbnail.png`;
  }

  const localDemoThumbnail = LOCAL_404_THUMBNAIL_BY_SLUG[String(slug || "").trim()];
  if (localDemoThumbnail) return localDemoThumbnail;

  return `${LOCAL_ARCADE_ASSET_BASE}/${ARCADE_KIND_404}/${slug}/${safeVersion}/files/assets/thumbnail.png`;
}

export function normalizeArcadeConfigResponse(
  siteId: string,
  enabled: boolean,
  gameSlug: string | null,
  gameVersion: string | null,
  optionsJson: Record<string, unknown> | null | undefined,
  updatedAt: Date
): ArcadeConfigPayload {
  return {
    siteId,
    enabled,
    gameSlug,
    gameVersion,
    options: mergeArcadeOptions(optionsJson as Partial<SiteArcadeOptions> | undefined),
    updatedAt: updatedAt.toISOString(),
  };
}

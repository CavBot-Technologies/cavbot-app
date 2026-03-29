import crypto from "crypto";

type ArcadeManifest = {
  schema?: number;
  kind: string;
  game: {
    id: string;
    displayName?: string;
    version: string;
  };
  entry: {
    html: string;
  };
  runtime?: Record<string, unknown>;
};

export type ArcadeGameEntry = {
  kind: string;
  slug: string;
  version: string;
  displayName: string;
  basePath: string;
  manifest: ArcadeManifest;
};

type StaticGameDefinition = {
  kind: string;
  slug: string;
  version: string;
  displayName: string;
  runtime?: Record<string, unknown>;
};

const STATIC_GAMES: StaticGameDefinition[] = [
  {
    kind: "404",
    slug: "catch-cavbot",
    version: "v1",
    displayName: "Catch CavBot",
    runtime: {
      requires: ["analytics", "brain", "badge", "head"],
      preferredEmbed: "iframe",
      sandbox: "allow-scripts allow-same-origin",
    },
  },
  {
    kind: "404",
    slug: "cavbot-cache-sweep",
    version: "v1",
    displayName: "CavBot Cache Sweep",
    runtime: {
      requires: ["analytics", "brain", "badge", "head"],
      preferredEmbed: "iframe",
      sandbox: "allow-scripts allow-same-origin",
    },
  },
  {
    kind: "404",
    slug: "cavbot-imposter",
    version: "v1",
    displayName: "CavBot Imposter",
    runtime: {
      requires: ["analytics", "brain", "badge", "head"],
      preferredEmbed: "iframe",
      sandbox: "allow-scripts allow-same-origin",
    },
  },
  {
    kind: "404",
    slug: "cavbot-signal-chase",
    version: "v1",
    displayName: "CavBot Signal Chase",
    runtime: {
      requires: ["analytics", "brain"],
      preferredEmbed: "iframe",
      sandbox: "allow-scripts allow-same-origin",
    },
  },
  {
    kind: "404",
    slug: "futbol-cavbot",
    version: "v1",
    displayName: "Futbol CavBot",
    runtime: {
      requires: ["analytics", "brain", "badge", "head"],
      preferredEmbed: "iframe",
      sandbox: "allow-scripts allow-same-origin",
    },
  },
  {
    kind: "404",
    slug: "tennis-cavbot",
    version: "v1",
    displayName: "Tennis CavBot",
    runtime: {
      requires: ["analytics", "brain"],
      preferredEmbed: "iframe",
      sandbox: "allow-scripts allow-same-origin",
    },
  },
];

const CATALOG: ArcadeGameEntry[] = STATIC_GAMES.map((game) => ({
  kind: game.kind,
  slug: game.slug,
  version: game.version,
  displayName: game.displayName,
  basePath: `/${game.kind}/${game.slug}/${game.version}`,
  manifest: {
    schema: 1,
    kind: game.kind,
    game: {
      id: game.slug,
      displayName: game.displayName,
      version: game.version,
    },
    entry: {
      html: "index.html",
    },
    runtime: game.runtime || {
      preferredEmbed: "iframe",
      sandbox: "allow-scripts allow-same-origin",
    },
  },
}));

function pickDeterministicIndex(seed: string, length: number) {
  if (!length) return 0;
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  const window = hash.slice(0, 8);
  const value = parseInt(window, 16);
  return Number.isFinite(value) ? value % length : 0;
}

export function getArcadeGames(kind: string): ArcadeGameEntry[] {
  return CATALOG.filter((entry) => entry.kind === kind);
}

export function pickArcadeGame(kind: string, siteId: string): ArcadeGameEntry | null {
  const games = getArcadeGames(kind);
  if (!games.length) return null;
  const seed = `${kind}:${siteId || "default"}`;
  const index = pickDeterministicIndex(seed, games.length);
  return games[index];
}

export function findArcadeGame(kind: string, slug: string, version?: string): ArcadeGameEntry | null {
  return (
    CATALOG.find((entry) => entry.kind === kind && entry.slug === slug && (!version || entry.version === version)) ||
    null
  );
}

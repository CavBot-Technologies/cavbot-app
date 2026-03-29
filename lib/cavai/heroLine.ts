export type CavAiSurface = "workspace" | "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode";
export type CavAiCopyContext = "general" | "diagnostics" | "storage" | "code";
export type CavAiTimeBucket = "morning" | "afternoon" | "evening";

export type CavAiIdentityInput = {
  fullName?: string | null;
  username?: string | null;
};

export const CAVAI_PROFILE_FULL_NAME_KEY = "cb_profile_fullName_v1";
export const CAVAI_PROFILE_USERNAME_KEY = "cb_profile_username_v1";
export const CAVAI_SAFE_FALLBACK_LINE = "What are we solving today?";

const memoryLastLineByScope = new Map<string, string>();
let memoryIdentity: CavAiIdentityInput = { fullName: "", username: "" };

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toName(value: unknown): string {
  return s(value).replace(/\s+/g, " ");
}

function toUsername(value: unknown): string {
  return s(value).replace(/^@+/, "");
}

function toUsernameInitial(username: string): string {
  const hit = s(username).match(/[A-Za-z0-9]/);
  if (!hit?.[0]) return "";
  return `${hit[0].toUpperCase()}.`;
}

function ensureSentenceTerminal(value: string): string {
  const text = s(value);
  if (!text) return "";
  if (/[.?!]$/.test(text)) return text.replace(/\.{2,}$/, ".");
  return `${text}.`;
}

function toAddressedLine(prefix: string, identity: string, comma = true): string {
  const lead = s(prefix);
  const who = s(identity);
  if (!lead || !who) return "";
  const glue = comma ? ", " : " ";
  return ensureSentenceTerminal(`${lead}${glue}${who}`);
}

function listUnique(lines: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines.map((row) => s(row)).filter(Boolean)) {
    if (seen.has(line)) continue;
    seen.add(line);
    unique.push(line);
  }
  return unique;
}

function randomInt(maxExclusive: number): number {
  if (!Number.isFinite(maxExclusive) || maxExclusive <= 1) return 0;
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return Math.floor((buffer[0] / 2 ** 32) * maxExclusive);
  }
  return Math.floor(Math.random() * maxExclusive);
}

export function resolveCavAiCopyContext(surface: CavAiSurface): CavAiCopyContext {
  if (surface === "console" || surface === "cavsafe") return "diagnostics";
  if (surface === "cavcloud") return "storage";
  if (surface === "cavcode") return "code";
  return "general";
}

export function resolveCavAiDisplayIdentity(input: CavAiIdentityInput): string | null {
  const fullName = toName(input.fullName);
  if (fullName) return fullName;
  const initial = toUsernameInitial(toUsername(input.username));
  if (initial) return initial;
  return null;
}

export function resolveCavAiTimeBucket(now: Date): CavAiTimeBucket {
  const hour = now.getHours();
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 17) return "afternoon";
  return "evening";
}

export function getTimeAwareIdentityLines(args: {
  now: Date;
  identity: string | null;
}): string[] {
  const bucket = resolveCavAiTimeBucket(args.now);
  const identity = s(args.identity);
  if (identity) {
    const timeGreeting =
      bucket === "morning"
        ? toAddressedLine("Good morning", identity, false)
        : bucket === "afternoon"
          ? toAddressedLine("Good afternoon", identity, false)
          : toAddressedLine("Good evening", identity, false);
    return [
      timeGreeting,
      toAddressedLine("It's good to see you", identity),
      toAddressedLine("Good to see you", identity),
      toAddressedLine("Ready when you are", identity),
      toAddressedLine("Glad you're here", identity),
    ];
  }
  const noIdentityGreeting =
    bucket === "morning"
      ? "Good morning."
      : bucket === "afternoon"
        ? "Good afternoon."
        : "Good evening.";
  return [
    noIdentityGreeting,
    "Ready when you are.",
    "Glad you're here.",
  ];
}

export function getHeadlinePool(context: CavAiCopyContext): string[] {
  if (context === "diagnostics") {
    return [
      "What needs attention today?",
      "What are we solving today?",
    ];
  }
  if (context === "storage") {
    return [
      "What should we organize today?",
      "What are we solving today?",
    ];
  }
  if (context === "code") {
    return [
      "What are we building today?",
      "What are we solving today?",
    ];
  }
  return [
    "What are we solving today?",
    "What are we building today?",
  ];
}

export function getAllowedLinePool(args: {
  surface: CavAiSurface;
  now: Date;
  identity: string | null;
}): string[] {
  const context = resolveCavAiCopyContext(args.surface);
  const personalizedLines = getTimeAwareIdentityLines({
    now: args.now,
    identity: args.identity,
  });
  const headlineLines = getHeadlinePool(context);
  return listUnique([...personalizedLines, ...headlineLines]);
}

export function pickNonRepeatingLine(pool: string[], lastLine: string | null | undefined): string {
  const options = listUnique(pool);
  if (!options.length) return CAVAI_SAFE_FALLBACK_LINE;
  const last = s(lastLine);
  const filtered = options.length > 1 ? options.filter((line) => line !== last) : options;
  const targetPool = filtered.length ? filtered : options;
  return targetPool[randomInt(targetPool.length)] || targetPool[0] || CAVAI_SAFE_FALLBACK_LINE;
}

export function rememberCavAiIdentity(input: CavAiIdentityInput): CavAiIdentityInput {
  memoryIdentity = {
    fullName: s(input.fullName),
    username: s(input.username),
  };
  return { ...memoryIdentity };
}

export function readCavAiIdentityFromStorage(): CavAiIdentityInput {
  return { ...memoryIdentity };
}

function readLastLine(scopeKey: string): string {
  const normalizedScope = s(scopeKey) || "default";
  const cached = s(memoryLastLineByScope.get(normalizedScope));
  if (cached) return cached;
  return "";
}

function writeLastLine(scopeKey: string, line: string): void {
  const normalizedScope = s(scopeKey) || "default";
  const normalizedLine = s(line);
  if (!normalizedLine) return;
  memoryLastLineByScope.set(normalizedScope, normalizedLine);
}

export function pickAndRememberCavAiLine(args: {
  surface: CavAiSurface;
  identity: CavAiIdentityInput;
  now?: Date;
  scopeKey?: string;
}): string {
  const now = args.now || new Date();
  const scopeKey = s(args.scopeKey) || args.surface;
  const identity = resolveCavAiDisplayIdentity(args.identity);
  const pool = getAllowedLinePool({
    surface: args.surface,
    now,
    identity,
  });
  const next = pickNonRepeatingLine(pool, readLastLine(scopeKey));
  writeLastLine(scopeKey, next);
  return next;
}

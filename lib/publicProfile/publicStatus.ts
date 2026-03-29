// lib/publicProfile/publicStatus.ts
// Shared user status model for public profiles (presence/intent only; not system health).

export const PUBLIC_STATUS_MODES = [
  "Monitoring",
  "Debugging",
  "Reviewing",
  "Optimizing",
  "Shipping",
  "Idle / Standby",
  "Coding",
  "Arcade",
  "Prototyping",
  "Offline",
] as const;

export type PublicStatusMode = (typeof PUBLIC_STATUS_MODES)[number];

export function isPublicStatusMode(v: unknown): v is PublicStatusMode {
  return typeof v === "string" && (PUBLIC_STATUS_MODES as readonly string[]).includes(v);
}

export const PUBLIC_STATUS_PICKER_OPTIONS = [
  { value: "Monitoring", label: "Monitoring" },
  { value: "Debugging", label: "Debugging" },
  { value: "Reviewing", label: "Reviewing" },
  { value: "Optimizing", label: "Optimizing" },
  { value: "Coding", label: "Coding" },
  { value: "Shipping", label: "Shipping" },
  { value: "Idle / Standby", label: "Idle / Standby" },
  { value: "Arcade", label: "Arcade" },
  { value: "Prototyping", label: "Prototyping" },
  { value: "Offline", label: "Offline" },
  { value: "", label: "Not set" },
] as const;

export type PublicStatusTone = "lime" | "blue" | "violet" | "red" | "white";

export function publicStatusToneFromMode(mode: unknown): PublicStatusTone {
  const m = typeof mode === "string" ? mode.trim() : "";
  if (!m) return "white";
  if (!isPublicStatusMode(m)) return "white";

  if (m === "Offline") return "red";
  if (m === "Shipping" || m === "Idle / Standby") return "blue";
  if (m === "Arcade" || m === "Prototyping") return "violet";
  return "lime";
}

export function isArcadeStatusMode(mode: unknown): boolean {
  return typeof mode === "string" && mode.trim() === "Arcade";
}

export function normalizePublicStatusNote(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Server enforces max length; keep normalization shared for client.
  return trimmed;
}

export function containsEmoji(s: string): boolean {
  // Enforce "no emojis anywhere" for status note. Works on modern Node/Chromium.
  try {
    return /\p{Extended_Pictographic}/u.test(s);
  } catch {
    // Fallback: reject non-BMP characters (covers most emoji).
    return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(s);
  }
}

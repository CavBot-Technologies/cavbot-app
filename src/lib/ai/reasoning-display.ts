export type ReasoningDisplayLevel = "low" | "medium" | "high" | "extra_high";

const REASONING_DISPLAY_LABELS: Record<ReasoningDisplayLevel, string> = {
  low: "Fast",
  medium: "Balanced",
  high: "Deep",
  extra_high: "Max",
};

const REASONING_DISPLAY_HELPERS: Record<ReasoningDisplayLevel, string> = {
  low: "Quickest response, lighter reasoning.",
  medium: "Best everyday default.",
  high: "Stronger multi-step thinking.",
  extra_high: "Highest reasoning effort for the hardest tasks.",
};

function toTitleCase(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(" ");
}

export function toReasoningDisplayLevel(value: unknown): ReasoningDisplayLevel | null {
  const normalized = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "extra_high") {
    return normalized;
  }
  return null;
}

export function toReasoningDisplayLabel(value: unknown): string {
  const level = toReasoningDisplayLevel(value);
  if (level) return REASONING_DISPLAY_LABELS[level];
  return toTitleCase(String(value || "")) || "Balanced";
}

export function toReasoningDisplayHelper(value: unknown): string {
  const level = toReasoningDisplayLevel(value);
  if (!level) return "";
  return REASONING_DISPLAY_HELPERS[level];
}

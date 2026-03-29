// lib/stripe.ts
import "server-only";

function env(name: string) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export type StripePlanId = "premium" | "premium_plus";
export type StripeBilling = "monthly" | "annual";

function normalizeOriginOrNull(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function getAppUrl() {
  const candidates = [
    process.env.CAVBOT_APP_ORIGIN,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_ORIGIN,
    process.env.APP_ORIGIN,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeOriginOrNull(String(candidate || ""));
    if (normalized) return normalized;
  }
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  throw new Error("Missing app origin env for Stripe redirect URLs.");
}

export function priceIdFor(plan: StripePlanId, billing: StripeBilling) {
  if (plan === "premium" && billing === "monthly") return env("STRIPE_PRICE_PREMIUM_MONTHLY");
  if (plan === "premium" && billing === "annual") return env("STRIPE_PRICE_PREMIUM_ANNUAL");
  if (plan === "premium_plus" && billing === "monthly") return env("STRIPE_PRICE_PREMIUM_PLUS_MONTHLY");
  if (plan === "premium_plus" && billing === "annual") return env("STRIPE_PRICE_PREMIUM_PLUS_ANNUAL");
  throw new Error("Bad plan/billing");
}

export function planFromPriceId(priceId: string): { planId: StripePlanId; billing: StripeBilling } | null {
  const p = String(priceId || "").trim();
  if (!p) return null;

  const map: Array<[string, StripePlanId, StripeBilling]> = [
    [String(process.env.STRIPE_PRICE_PREMIUM_MONTHLY || "").trim(), "premium", "monthly"],
    [String(process.env.STRIPE_PRICE_PREMIUM_ANNUAL || "").trim(), "premium", "annual"],
    [String(process.env.STRIPE_PRICE_PREMIUM_PLUS_MONTHLY || "").trim(), "premium_plus", "monthly"],
    [String(process.env.STRIPE_PRICE_PREMIUM_PLUS_ANNUAL || "").trim(), "premium_plus", "annual"],
  ];

  for (const [id, planId, billing] of map) {
    if (id && id === p) return { planId, billing };
  }
  return null;
}

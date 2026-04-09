// lib/stripeClient.ts
import "server-only";
import type Stripe from "stripe";

function env(name: string) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let stripeInstancePromise: Promise<Stripe> | null = null;

async function createStripeClient() {
  const { default: StripeClient } = await import("stripe");
  return new StripeClient(env("STRIPE_SECRET_KEY"), {
    apiVersion: "2025-12-15.clover",
  });
}

export function getStripe() {
  if (!stripeInstancePromise) {
    stripeInstancePromise = createStripeClient();
  }
  return stripeInstancePromise;
}
export type StripeClient = Awaited<ReturnType<typeof getStripe>>;

// lib/stripeClient.ts
import "server-only";
import Stripe from "stripe";

function env(name: string) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let stripeInstance: Stripe | null = null;

function createStripeClient() {
  return new Stripe(env("STRIPE_SECRET_KEY"), {
    apiVersion: "2025-12-15.clover",
  });
}

export function getStripe() {
  if (!stripeInstance) {
    stripeInstance = createStripeClient();
  }
  return stripeInstance;
}
export type StripeClient = ReturnType<typeof getStripe>;

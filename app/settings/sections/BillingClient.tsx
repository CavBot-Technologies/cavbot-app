// app/settings/sections/BillingClient.tsx
"use client";


import Image from "next/image";
import * as React from "react";
import "./billing.css";


import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";


import { COUNTRY_NAME_BY_CODE } from "@/geo/countries";
import { PLANS } from "@/lib/plans";


type Tone = "good" | "watch" | "bad";
type PlanId = "free" | "premium" | "premium_plus";
type BillingCycle = "monthly" | "annual";


type BillingSummary = {
  ok: true;


  account: {
    id: string;
    slug: string;
    tier: "FREE" | "PREMIUM" | "ENTERPRISE";
    billingEmail: string | null;
    stripeCustomerId?: string | null;


    pendingDowngradePlanId: "free" | "premium" | null;
    pendingDowngradeBilling: BillingCycle | null;
    pendingDowngradeAt: string | null;
    pendingDowngradeEffectiveAt: string | null;


    lastUpgradePlanId: "premium" | "premium_plus" | null;
    lastUpgradeBilling: BillingCycle | null;
    lastUpgradeAt: string | null;
    lastUpgradeProrated: boolean | null;
  };


  subscription: null | {
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";
    tier: "FREE" | "PREMIUM" | "ENTERPRISE";
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    provider: string | null;
    customerId: string | null;
    billingCycle?: BillingCycle | null;
  };


  computed: {
    currentPlanId: PlanId;
    seatLimit: number | null;
    websiteLimit: number | null;
    seatsUsed: number;
    websitesUsed: number;
    billingCycle: BillingCycle;
  };
  qwenCoderUsage?: null | {
    planLabel?: string;
    resetAt?: string;
    cooldownEndsAt?: string | null;
    billingCycleStart?: string;
    billingCycleEnd?: string;
    usage?: {
      creditsUsed?: number;
      creditsLeft?: number;
      creditsTotal?: number;
      percentUsed?: number;
    };
    entitlement?: {
      state?: string;
      selectable?: boolean;
      warningLevel?: number | null;
    };
    recentUsage?: Array<{
      requestId?: string;
      creditsCharged?: number;
      createdAt?: string;
      chargeState?: string;
      modelName?: string;
    }>;
  };
};


type InvoiceRow = {
  id: string;
  createdAt: string;
  title: string;
  amount: string;


  // supports Stripe failures + backend union
  status: "posted" | "scheduled" | "archived" | "failed";


  // secured download route (preferred)
  downloadUrl?: string | null;


  meta?: Record<string, unknown>;
};


type InvoiceFilter = "all" | "active" | "archived";


type PaymentMethodSummary = {
  ok: true;
  hasPaymentMethod: boolean;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  billingName: string | null;
};


type ApiErrorPayload = Record<string, unknown> & { ok?: boolean; message?: string; error?: string };
type SetupIntentResponse = { ok: true; clientSecret: string };

const SHELL_PLAN_SNAPSHOT_KEY = "cb_shell_plan_snapshot_v1";
const PLAN_CONTEXT_KEY = "cb_plan_context_v1";

function normalizePlanId(input: unknown): PlanId | null {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "premium_plus" || value === "premium+" || value === "plus" || value === "enterprise") {
    return "premium_plus";
  }
  if (value === "premium" || value === "pro" || value === "paid") return "premium";
  if (value === "free") return "free";
  return null;
}

function readBootPlanId(): PlanId {
  if (typeof window === "undefined") return "free";

  try {
    const raw = globalThis.__cbLocalStore.getItem(SHELL_PLAN_SNAPSHOT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { planTier?: unknown } | null;
      const fromSnapshot = normalizePlanId(parsed?.planTier);
      if (fromSnapshot) return fromSnapshot;
    }
  } catch {}

  try {
    const raw = globalThis.__cbLocalStore.getItem(PLAN_CONTEXT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { planKey?: unknown; planLabel?: unknown } | null;
      const fromLegacy = normalizePlanId(parsed?.planKey || parsed?.planLabel);
      if (fromLegacy) return fromLegacy;
    }
  } catch {}

  return "free";
}


async function apiJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
    cache: "no-store",
  });


  const data = (await res.json().catch(() => ({}))) as ApiErrorPayload;
  if (!res.ok || data?.ok === false) {
    const msg = data?.message || data?.error || "Request failed";
    throw Object.assign(new Error(String(msg)), { status: res.status, data });
  }
  return data as T;
}


function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "—";
  }
}


function fmtLimit(n: number | null) {
  return n === null ? "Unlimited" : String(n);
}


function planLabel(planId: PlanId) {
  if (planId === "premium_plus") return "PREMIUM+";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}


function planTitle(planId: PlanId) {
  if (planId === "premium_plus") return PLANS.premium_plus?.displayName ?? "CavElite";
  if (planId === "premium") return PLANS.premium?.displayName ?? "CavControl";
  return PLANS.free?.displayName ?? "CavTower";
}


function planSub(planId: PlanId) {
  if (planId === "free") return "Core access and essentials. Upgrade anytime.";
  if (planId === "premium")
    return (
      <>
        Serious monitoring depth,
        <br />
        premium modules unlocked.
       
       
      </>
    );
  return "Full CavBot scale. Every module, maximum capacity.";
}


function planWebsites(planId: PlanId) {
  const lim = PLANS?.[planId]?.limits?.websites;
  if (lim === "unlimited") return "Unlimited";
  return String(lim ?? "—");
}


function planSeats(planId: PlanId) {
  if (planId === "free") return "4";
  if (planId === "premium") return "8";
  return "16";
}

function planStorage(planId: PlanId) {
  const lim = PLANS?.[planId]?.limits?.storageGb;
  if (!lim || lim === "unlimited") return "Unlimited";
  return `${lim} GB`;
}


/**
 * Enterprise invoice download priority:
 * 1) top-level downloadUrl (secured redirect route)
 * 2) meta.downloadUrl
 * 3) Stripe direct fallbacks if present in meta
 */
function invoiceDownloadUrl(r: InvoiceRow): string {
  const m = r?.meta || {};
  return String(
    r?.downloadUrl ||
      m.downloadUrl ||
      m.invoicePdfUrl ||
      m.invoice_pdf ||
      m.pdfUrl ||
      m.invoicePdf ||
      m.hostedInvoiceUrl ||
      m.hosted_invoice_url ||
      ""
  ).trim();
}


function invoiceBucket(r: InvoiceRow): "active" | "archived" {
  if (r.status === "archived") return "archived";
  return "active";
}


function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 3c.6 0 1 .4 1 1v8.2l2.5-2.5a1 1 0 1 1 1.4 1.4l-4.2 4.2a1 1 0 0 1-1.4 0L7.1 11.1a1 1 0 1 1 1.4-1.4L11 12.2V4c0-.6.4-1 1-1z"
        fill="currentColor"
        opacity="0.92"
      />
      <path
        d="M5 19.2c0-.6.4-1 1-1h12c.6 0 1 .4 1 1s-.4 1-1 1H6c-.6 0-1-.4-1-1z"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  );
}


/* =========================
 STRIPE ELEMENTS WRAPPER
========================= */


const pk = String(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "").trim();
const stripePromise: Promise<Stripe | null> | null = pk ? loadStripe(pk) : null;


function usePrettyNull(v: string | null | undefined, fallback: string) {
  const s = String(v || "").trim();
  return s ? s : fallback;
}


function buildPeriodEndLabel(planId: PlanId, isoEnd: string | null | undefined) {
  if (isoEnd) return fmtDate(isoEnd);
  if (planId === "free") return "Never";
  return "—";
}


function buildBillingEmailLabel(planId: PlanId, email: string | null | undefined) {
  const s = String(email || "").trim();
  if (s) return s;
  return planId === "free" ? "Account not billed" : "—";
}


/* =========================
 CARD BRAND ICONS
========================= */


function BrandMark({ brand }: { brand: string }) {
  const b = String(brand || "").toLowerCase().trim();
  if (!b) return null;


  if (b.includes("visa")) {
    return (
      <span className="sx-cardBrand" aria-hidden="true" title="Visa">
        <svg viewBox="0 0 64 24" focusable="false" aria-hidden="true">
          <text
            x="32"
            y="17"
            textAnchor="middle"
            fontSize="16"
            fontWeight="800"
            fontFamily="system-ui, -apple-system, Segoe UI, Inter, Arial"
            fill="rgba(234,240,255,0.92)"
            letterSpacing="0.08em"
          >
            VISA
          </text>
        </svg>
      </span>
    );
  }


  if (b.includes("mastercard") || b.includes("master")) {
    return (
      <span className="sx-cardBrand" aria-hidden="true" title="Mastercard">
        <svg viewBox="0 0 48 24" focusable="false" aria-hidden="true">
          <circle cx="20" cy="12" r="7.5" fill="rgba(255,92,92,0.92)" />
          <circle cx="28" cy="12" r="7.5" fill="rgba(255,185,90,0.92)" />
          <path d="M24 4.6a8.6 8.6 0 0 1 0 14.8a8.6 8.6 0 0 1 0-14.8z" fill="rgba(255,130,60,0.92)" />
        </svg>
      </span>
    );
  }


  if (b.includes("amex") || b.includes("american")) {
    return (
      <span className="sx-cardBrand" aria-hidden="true" title="American Express">
        <svg viewBox="0 0 64 24" focusable="false" aria-hidden="true">
          <rect x="2" y="3" width="60" height="18" rx="6" fill="rgba(78,168,255,0.22)" />
          <text
            x="32"
            y="17"
            textAnchor="middle"
            fontSize="14"
            fontWeight="800"
            fontFamily="system-ui, -apple-system, Segoe UI, Inter, Arial"
            fill="rgba(234,240,255,0.92)"
            letterSpacing="0.10em"
          >
            AMEX
          </text>
        </svg>
      </span>
    );
  }


  return null;
}


/* =========================
 CARD DETAILS FORM
========================= */


function CardDetailsForm(props: {
  busy: boolean;
  onBusy: (b: boolean) => void;
  onToast: (msg: string, tone?: Tone) => void;


  // After a successful save, we want:
  // - instant CavCard update (no extra GET)
  // - then refresh summary/invoices in parent (billing state)
  onPmUpdated: (pm: PaymentMethodSummary) => void;
  onSaved: () => Promise<void>;


  cardName: string;
  setCardName: (s: string) => void;


  billing1: string;
  setBilling1: (s: string) => void;
  billing2: string;
  setBilling2: (s: string) => void;
  billingCity: string;
  setBillingCity: (s: string) => void;
  billingRegion: string;
  setBillingRegion: (s: string) => void;
  billingPostal: string;
  setBillingPostal: (s: string) => void;
  billingCountry: string;
  setBillingCountry: (s: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();


  function makeIdem() {
    try {
      type CryptoWithUUID = Crypto & { randomUUID?: () => string };
      const c = (globalThis as typeof globalThis & { crypto?: CryptoWithUUID }).crypto;
      if (c?.randomUUID) return c.randomUUID();
    } catch {}
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }


  const submit = async () => {
    if (props.busy) return;


    if (!stripePromise || !pk) {
      props.onToast("Missing publishable key. Add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and restart.", "bad");
      return;
    }
    if (!stripe || !elements) {
      props.onToast("Card UI not ready yet. Refresh and try again.", "watch");
      return;
    }


    const cardNumber = elements.getElement(CardNumberElement);
    if (!cardNumber) {
      props.onToast("Card fields not mounted.", "bad");
      return;
    }


    props.onBusy(true);
    try {
      const idem = makeIdem();


      // Step 1: create SetupIntent (server)
      const si = await apiJSON<SetupIntentResponse>("/api/billing/payment-method", {
        method: "POST",
        headers: { "x-idempotency-key": `pm_setup_${idem}` },
        body: JSON.stringify({
          name: props.cardName,
          address: {
            line1: props.billing1,
            line2: props.billing2,
            city: props.billingCity,
            state: props.billingRegion,
            postal_code: props.billingPostal,
            country: props.billingCountry,
          },
        }),
      });


      // Step 2: confirm setup with Stripe Elements
      const result = await stripe.confirmCardSetup(si.clientSecret, {
        payment_method: {
          card: cardNumber,
          billing_details: {
            name: props.cardName || undefined,
            address: {
              line1: props.billing1 || undefined,
              line2: props.billing2 || undefined,
              city: props.billingCity || undefined,
              state: props.billingRegion || undefined,
              postal_code: props.billingPostal || undefined,
              country: props.billingCountry || undefined,
            },
          },
        },
      });


      // Must check error first
      const confirmed = result as {
        error?: { message?: string };
        setupIntent?: { id?: string };
        setupIntentId?: string;
      };
      if (confirmed.error) {
        props.onToast(confirmed.error.message || "Card could not be saved.", "bad");
        return;
      }


      // Step 3: finalize default PM (server) + return fresh payload for instant CavCard update
      const setupIntentId = confirmed.setupIntent?.id || confirmed.setupIntentId || "";


      if (setupIntentId) {
        const pmRes = await apiJSON<PaymentMethodSummary>("/api/billing/payment-method", {
          method: "POST",
          headers: { "x-idempotency-key": `pm_finalize_${idem}` },
          body: JSON.stringify({ setupIntentId }),
        });


        props.onPmUpdated(pmRes);
        if (pmRes?.billingName) props.setCardName(String(pmRes.billingName));
      }


      props.onToast("Card details saved.", "good");
      await props.onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      props.onToast(message || "Failed to save card.", "bad");
    } finally {
      props.onBusy(false);
    }
  };


  return (
    <>
      <br />
      <br />
      <div className="sx-cardDetails" aria-label="Card details">
        <div className="sx-cardDetailsHead">
          <div>
            <div className="sx-kicker">Card details</div>
            <div className="sx-cardSub">Select default payment method.</div>
          </div>

          <button
            className={`sx-btn sx-btnPrimary sx-btnToneLinked sx-cardSaveTop ${props.busy ? "is-disabled" : ""}`}
            type="button"
            onClick={submit}
            disabled={props.busy}
          >
            Save card
          </button>
        </div>


        <div className="sx-divider sx-billDivider" aria-hidden="true" />

        <div className="sx-cardFormWide">
          <div className="sx-cardFormCol">
            <div className="sx-field">
              <label className="sx-label">Name on card</label>
              <input
                className="sx-input"
                value={props.cardName}
                onChange={(e) => props.setCardName(e.target.value)}
                placeholder="Full name"
                autoComplete="cc-name"
              />
            </div>


            <br />
            <div className="sx-field">
              <label className="sx-label">Card number</label>
              <div className="sx-stripeBox">
                <CardNumberElement options={{ showIcon: true }} />
              </div>
            </div>


            <br />
            <div className="sx-cardMiniRow">
              <div className="sx-field">
                <label className="sx-label">CVV</label>
                <div className="sx-stripeBox">
                  <CardCvcElement />
                </div>
              </div>


              <div className="sx-field">
                <label className="sx-label">Expiry</label>
                <div className="sx-stripeBox">
                  <CardExpiryElement />
                </div>
              </div>
            </div>
          </div>


          <div className="sx-cardFormCol">
            <div className="sx-field">
              <label className="sx-label">Billing address</label>
              <input
                className="sx-input"
                value={props.billing1}
                onChange={(e) => props.setBilling1(e.target.value)}
                placeholder="Street address"
                autoComplete="address-line1"
              />
            </div>


            <br />
            <div className="sx-field">
              <label className="sx-label">Apt / suite</label>
              <input
                className="sx-input"
                value={props.billing2}
                onChange={(e) => props.setBilling2(e.target.value)}
                placeholder="Unit / suite (optional)"
                autoComplete="address-line2"
              />
            </div>


            <br />
            <div className="sx-cardMiniRow">
              <div className="sx-field">
                <label className="sx-label">City</label>
                <input
                  className="sx-input"
                  value={props.billingCity}
                  onChange={(e) => props.setBillingCity(e.target.value)}
                  placeholder="City"
                  autoComplete="address-level2"
                />
              </div>


              <div className="sx-field">
                <label className="sx-label">Region</label>
                <input
                  className="sx-input"
                  value={props.billingRegion}
                  onChange={(e) => props.setBillingRegion(e.target.value)}
                  placeholder="State"
                  autoComplete="address-level1"
                />
              </div>
            </div>


            <br />
            <div className="sx-cardMiniRow">
              <div className="sx-field">
                <label className="sx-label">Postal</label>
                <input
                  className="sx-input"
                  value={props.billingPostal}
                  onChange={(e) => props.setBillingPostal(e.target.value)}
                  placeholder="Postal"
                  autoComplete="postal-code"
                />
              </div>


              <div className="sx-field">
                <label className="sx-label">Country</label>
                <select
                  className="sx-select"
                  value={props.billingCountry}
                  onChange={(e) => props.setBillingCountry(e.target.value)}
                  aria-label="Country"
                >
                  {Array.from(COUNTRY_NAME_BY_CODE.entries()).map(([code, name]) => (
                    <option key={code} value={code}>
                      {name} ({code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="sx-cardSaveRow sx-cardSaveRow--mobile">
          <button
            className={`sx-btn sx-btnPrimary sx-btnToneLinked ${props.busy ? "is-disabled" : ""}`}
            type="button"
            onClick={submit}
            disabled={props.busy}
          >
            Save card
          </button>
        </div>
      </div>
    </>
  );
}


/* =========================
 MAIN
========================= */


function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true">
      <path
        d="M7.2 7.1a7 7 0 0 1 11 1.5 1 1 0 1 1-1.8.9A5 5 0 0 0 8.6 8.3l1.1 1.1a1 1 0 0 1-.7 1.7H5.9a1 1 0 0 1-1-1V6.8a1 1 0 0 1 1.7-.7l.6.6zm9.6 9.8a7 7 0 0 1-11-1.5 1 1 0 1 1 1.8-.9 5 5 0 0 0 7.8 1.2l-1.1-1.1a1 1 0 0 1 .7-1.7h3.1a1 1 0 0 1 1 1v3.1a1 1 0 0 1-1.7.7l-.6-.6z"
        fill="currentColor"
        opacity="0.92"
      />
    </svg>
  );
}


function BillingClientInner() {
  const [err, setErr] = React.useState("");
  const [summary, setSummary] = React.useState<BillingSummary | null>(null);
  const [bootPlanId, setBootPlanId] = React.useState<PlanId>("free");


  const [pm, setPm] = React.useState<PaymentMethodSummary | null>(null);


  const [invoices, setInvoices] = React.useState<InvoiceRow[]>([]);
  const [invFilter, setInvFilter] = React.useState<InvoiceFilter>("all");


  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<{ tone: Tone; msg: string } | null>(null);
  const toastTimer = React.useRef<number | null>(null);


  const [cardName, setCardName] = React.useState("");
  const [billing1, setBilling1] = React.useState("");
  const [billing2, setBilling2] = React.useState("");
  const [billingCity, setBillingCity] = React.useState("");
  const [billingRegion, setBillingRegion] = React.useState("");
  const [billingPostal, setBillingPostal] = React.useState("");
  const [billingCountry, setBillingCountry] = React.useState("US");


  const [cardFlipped, setCardFlipped] = React.useState(false);


  const plansRef = React.useRef<HTMLDivElement | null>(null);
  const [planDot, setPlanDot] = React.useState(0);

  React.useEffect(() => {
    setBootPlanId(readBootPlanId());
  }, []);


  function pushToast(msg: string, tone: Tone = "good") {
    setToast({ msg, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }


  const refresh = React.useCallback(async () => {
    setErr("");
    try {
      const s = await apiJSON<BillingSummary>("/api/billing/summary");
      setSummary(s);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErr(message || "Failed to load billing.");
    }
  }, []);


  const refreshInvoices = React.useCallback(async () => {
    try {
      const d = await apiJSON<{ ok: true; invoices: InvoiceRow[] }>("/api/billing/invoices");
      setInvoices(d.invoices || []);
    } catch {
      setInvoices([]);
    }
  }, []);


  const refreshPaymentMethod = React.useCallback(async () => {
    try {
      const d = await apiJSON<PaymentMethodSummary>("/api/billing/payment-method");
      setPm(d);
    } catch {
      setPm(null);
    }
  }, []);


  React.useEffect(() => {
    refresh();
    refreshInvoices();
    refreshPaymentMethod();
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [refresh, refreshInvoices, refreshPaymentMethod]);

  React.useEffect(() => {
    const livePlanId = summary?.computed.currentPlanId;
    if (!livePlanId || typeof window === "undefined") return;

    const planTier = livePlanId === "premium_plus" ? "PREMIUM_PLUS" : livePlanId === "premium" ? "PREMIUM" : "FREE";

    try {
      const raw = globalThis.__cbLocalStore.getItem(SHELL_PLAN_SNAPSHOT_KEY);
      const previous = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      globalThis.__cbLocalStore.setItem(
        SHELL_PLAN_SNAPSHOT_KEY,
        JSON.stringify({
          ...previous,
          planTier,
          ts: Date.now(),
        })
      );
    } catch {}
  }, [summary?.computed.currentPlanId]);


  React.useEffect(() => {
    const el = plansRef.current;
    if (!el) return;


    const onScroll = () => {
      const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-plan-card='1']"));
      if (!cards.length) return;


      const cRect = el.getBoundingClientRect();
      const cx = cRect.left + cRect.width / 2;


      let best = 0;
      let bestDist = Infinity;
      cards.forEach((card, idx) => {
        const r = card.getBoundingClientRect();
        const mx = r.left + r.width / 2;
        const d = Math.abs(mx - cx);
        if (d < bestDist) {
          bestDist = d;
          best = idx;
        }
      });


      setPlanDot(best);
    };


    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);


  const currentPlanId = summary?.computed.currentPlanId ?? bootPlanId;
  const pending = summary?.account?.pendingDowngradePlanId
    ? {
        toPlan: summary.account.pendingDowngradePlanId,
        effectiveAt: summary.account.pendingDowngradeEffectiveAt,
        scheduledAt: summary.account.pendingDowngradeAt,
      }
    : null;


  const billingEmailLabel = buildBillingEmailLabel(currentPlanId, summary?.account?.billingEmail || null);
  const periodEndLabel = buildPeriodEndLabel(currentPlanId, summary?.subscription?.currentPeriodEnd || null);


  function actionForPlan(pid: PlanId): { kind: "current" | "upgrade" | "downgrade"; href?: string } {
    if (pid === currentPlanId) return { kind: "current" };
    const rank = (p: PlanId) => (p === "free" ? 1 : p === "premium" ? 2 : 3);
    const rCur = rank(currentPlanId);
    const rPid = rank(pid);
    if (rPid > rCur)
      return { kind: "upgrade", href: `/settings/upgrade?plan=${pid}&billing=${summary?.computed.billingCycle || "monthly"}` };
    const target = pid === "premium_plus" ? "premium" : pid;
    return { kind: "downgrade", href: `/settings/downgrade?plan=${target}&billing=${summary?.computed.billingCycle || "monthly"}` };
  }


  const visibleInvoices = React.useMemo(() => {
    const all = invoices || [];
    if (invFilter === "all") return all;
    if (invFilter === "archived") return all.filter((x) => invoiceBucket(x) === "archived");
    return all.filter((x) => invoiceBucket(x) === "active");
  }, [invoices, invFilter]);


  const digitalName = usePrettyNull(pm?.billingName || cardName, "CARDHOLDER NAME");
  const digitalBrand = String(pm?.brand || "").trim();
  const digitalExp =
    pm?.expMonth && pm?.expYear ? `${String(pm.expMonth).padStart(2, "0")}/${String(pm.expYear).slice(-2)}` : "11/34";


  return (
    <section className="sx-panel" aria-label="Billing settings">
      <header className="sx-panelHead sx-billingHead">
        <div>
          <h2 className="sx-h2">Billing</h2>
          <p className="sx-sub">Plan, subscription status, payment method, and invoices.</p>
        </div>
      </header>


      <div className="sx-body">
        {err ? <div className="sx-billError">{err}</div> : null}


        <div className="sx-billPlans sx-billPlansSlider" aria-label="Plans" ref={plansRef}>
          {(["free", "premium", "premium_plus"] as PlanId[]).map((pid) => {
            const isCurrent = pid === currentPlanId;
            const action = actionForPlan(pid);


            return (
              <div key={pid} className={`sx-billPlanCard ${isCurrent ? "is-current" : ""}`} data-plan-card="1">
                <div className="sx-billPlanTop">
                  <div className="sx-billPlanBadge">{planLabel(pid)}</div>
                </div>


                <br />
                <div className="sx-billPlanTitle">{planTitle(pid)}</div>
                <br /> <div className="sx-billPlanSub">{planSub(pid)}</div>
                <br />


                <div className="sx-billPlanMeta">
                  <div className="sx-billMetaRow">
                    <span>Websites</span>
                    <b>{planWebsites(pid)}</b>
                  </div>
                  <div className="sx-billMetaRow">
                    <span>Seats</span>
                    <b>{planSeats(pid)}</b>
                  </div>
                  <div className="sx-billMetaRow">
                    <span>CavCloud</span>
                    <b>{planStorage(pid)}</b>
                  </div>
                </div>


                <br />
                <br />


                <div className="sx-billPlanActions">
                  {action.kind === "current" ? (
                    <button className="sx-btn sx-btnMuted" type="button" disabled aria-disabled="true">
                      Current plan
                    </button>
                  ) : action.kind === "upgrade" ? (
                    <a className="sx-btn sx-btnPrimary sx-btnToneLinked" href={action.href}>
                      Upgrade
                    </a>
                  ) : (
                    <a className="sx-btn sx-btnGhost" href={action.href}>
                      Downgrade
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>


        <div className="sx-planDots" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`sx-dot ${planDot === i ? "is-on" : ""}`} />
          ))}
        </div>


        <br />


        {pending ? (
          <div className="sx-billPending" role="status" aria-live="polite">
            <div className="sx-billPendingLeft">
              <div className="sx-billPendingTitle">Downgrade scheduled</div>
              <div className="sx-billPendingSub">
                To <b>{planTitle(pending.toPlan as PlanId)}</b> • Effective {fmtDate(pending.effectiveAt)} • Scheduled{" "}
                {fmtDate(pending.scheduledAt)}
              </div>
            </div>


            <button
              className={`sx-btn sx-btnGhost ${busy ? "is-disabled" : ""}`}
              type="button"
              onClick={async () => {
                if (busy) return;
                const ok = window.confirm("Cancel the scheduled downgrade?");
                if (!ok) return;


                setBusy(true);
                try {
                  await apiJSON<{ ok: true }>("/api/billing/cancel-downgrade", { method: "POST" });
                  pushToast("Downgrade canceled.", "good");
                  await refresh();
                  await refreshInvoices();
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  pushToast(message || "Cancel failed.", "bad");
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              Cancel downgrade
            </button>
          </div>
        ) : null}

        <div className="sx-billPayGrid" aria-label="Payment and billing details">
          <div className="sx-walletCard sx-walletCardMatch sx-cavcardShell" aria-label="Payment method card">
            <div className={`sx-cavcard ${cardFlipped ? "is-flipped" : ""}`}>
              <div className="sx-cavcardFace sx-cavcardFront">
                <div className="sx-cardTop">
                  <div className="sx-chipSlot" aria-hidden="true">
                    <Image
                      className="sx-chipImg"
                      src="/cavpay/cavcard-chip.svg"
                      alt=""
                      width={48}
                      height={40}
                      unoptimized
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                    />
                  </div>


                  <div className="sx-cardTopRight">
                    <Image
                      className="sx-cardWordmark"
                      src="/logo/cavbot-wordmark.svg"
                      alt=""
                      width={120}
                      height={32}
                      unoptimized
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                    />
                  </div>
                </div>


                <br />


                <div className="sx-cardSep" aria-hidden="true" />


                <br /><br />


                <div className="sx-cardNumberLine" aria-label="Card number">
                  <span className="sx-cardNumMuted">4006&nbsp;••••&nbsp;••••&nbsp;</span>
                  <span className="sx-cardNumLast4">{pm?.last4 ? pm.last4 : "0008"}</span>
                </div>


                <br /><br />


                <div className="sx-cardMetaStack">
                  <div className="sx-cardName">{digitalName}</div>
                  <div className="sx-cardExp">Exp {digitalExp}</div>
                </div>


                <div className="sx-cardBrandCorner">
                  <BrandMark brand={digitalBrand} />
                </div>
              </div>


              <div className="sx-cavcardFace sx-cavcardBack" aria-hidden={!cardFlipped}>
                <div className="sx-cardBackStrip" aria-hidden="true" />


                <div className="sx-cardBackSigRow" aria-hidden="true">
                  <div className="sx-cardBackSig" />
                  <div className="sx-cardBackCvv">•••</div>
                </div>


                <div className="sx-cardBackMeta">
                  <div className="sx-cardBackNote">Security code is never shown.</div>


                  <div className="sx-cardBackMark">
                    <Image
                      className="sx-cardMark"
                      src="/logo/cavbot-logomark.svg"
                      alt=""
                      width={64}
                      height={64}
                      unoptimized
                      onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                    />
                  </div>
                </div>
              </div>
            </div>


            <div className="sx-cardFlipDock">
              <button
                className="sx-cardFlipBtn"
                type="button"
                aria-label="Flip card"
                onClick={() => setCardFlipped((v) => !v)}
              >
                <FlipIcon />
              </button>
            </div>
          </div>


          <div className="sx-cardDetailsSpan">
            <Elements
              stripe={stripePromise}
              options={{
                appearance: {
                  theme: "night",
                  variables: {
                    colorPrimary: "#b9c85a",
                    colorText: "rgba(234,240,255,0.92)",
                    colorBackground: "rgba(0,0,0,0.0)",
                    colorDanger: "rgba(255,120,120,1)",
                    fontFamily: "system-ui, -apple-system, Segoe UI, Inter, Arial",
                    borderRadius: "14px",
                  },
                },
              }}
            >
              <CardDetailsForm
                busy={busy}
                onBusy={setBusy}
                onToast={pushToast}
                onPmUpdated={(nextPm) => {
                  setPm(nextPm);
                  if (nextPm?.billingName) setCardName(String(nextPm.billingName));
                }}
                onSaved={async () => {
                  await refresh();
                  await refreshInvoices();
                }}
                cardName={cardName}
                setCardName={setCardName}
                billing1={billing1}
                setBilling1={setBilling1}
                billing2={billing2}
                setBilling2={setBilling2}
                billingCity={billingCity}
                setBillingCity={setBillingCity}
                billingRegion={billingRegion}
                setBillingRegion={setBillingRegion}
                billingPostal={billingPostal}
                setBillingPostal={setBillingPostal}
                billingCountry={billingCountry}
                setBillingCountry={setBillingCountry}
              />
            </Elements>
          </div>
        </div>

        <div className="sx-billDetailsCenter">
          <div className="sx-billDetails sx-billDetailsMatch">
            <div className="sx-billDetailsHeader">
              <div>
                <div className="sx-kicker">Billing details</div>
                <div className="sx-cardSub">Statement, renewal window, and limits kept in sync with your tier.</div>
              </div>
            </div>

            <div className="sx-billDetailsGrid">
              <article className="sx-billDetailCard sx-billCardWide">
                <div className="sx-billDetailLabel">Billing email</div>
                <div className="sx-billDetailValue">{billingEmailLabel}</div>
                <p className="sx-billDetailMeta">Receipts and payment updates get sent here.</p>
              </article>

              <article className="sx-billDetailCard">
                <div className="sx-billDetailLabel">Billing cycle</div>
                <div className="sx-billDetailValue">
                  {currentPlanId === "free" ? "None" : summary?.computed?.billingCycle || "monthly"}
                </div>
                <p className="sx-billDetailMeta">Rolling on the plan you selected.</p>
              </article>

              <article className="sx-billDetailCard">
                <div className="sx-billDetailLabel">Period end</div>
                <div className="sx-billDetailValue">{periodEndLabel}</div>
                <p className="sx-billDetailMeta">Renewal window for the current billing cycle.</p>
              </article>

              <article className="sx-billDetailCard">
                <div className="sx-billDetailLabel">Seat limit</div>
                <div className="sx-billDetailValue">{fmtLimit(summary?.computed?.seatLimit ?? null)}</div>
                <div className="sx-billDetailTag">Active seats: {summary?.computed?.seatsUsed ?? 0}</div>
              </article>

              <article className="sx-billDetailCard">
                <div className="sx-billDetailLabel">Site limit</div>
                <div className="sx-billDetailValue">{fmtLimit(summary?.computed?.websiteLimit ?? null)}</div>
                <div className="sx-billDetailTag">Assigned: {summary?.computed?.websitesUsed ?? 0}</div>
              </article>
            </div>
          </div>
        </div>

        <div className="sx-card" aria-label="Invoices">
          <div className="sx-billInvHead">
            <div>
              <div className="sx-kicker">Invoices</div>
              <div className="sx-cardSub">Download history and billing events.</div>
            </div>


            <div className="sx-billInvFilters" role="tablist" aria-label="Invoice filters">
              <button
                className={`sx-invTab ${invFilter === "all" ? "is-on" : ""}`}
                type="button"
                onClick={() => setInvFilter("all")}
              >
                All
              </button>
              <button
                className={`sx-invTab ${invFilter === "active" ? "is-on" : ""}`}
                type="button"
                onClick={() => setInvFilter("active")}
              >
                Active
              </button>
              <button
                className={`sx-invTab ${invFilter === "archived" ? "is-on" : ""}`}
                type="button"
                onClick={() => setInvFilter("archived")}
              >
                Archived
              </button>
            </div>
          </div>


          <div className="sx-divider sx-billDivider" aria-hidden="true" />


          {visibleInvoices?.length ? (
            <div className="sx-billInvoiceList">
              {visibleInvoices.map((r) => {
                const dl = invoiceDownloadUrl(r);
                const isArchived = invoiceBucket(r) === "archived";
                const isActive = !isArchived;


                return (
                  <div key={r.id} className="sx-billInvoiceRow">
                    <div className="sx-billInvoiceMain">
                      <div className="sx-billInvoiceTitle">{r.title}</div>
                      <div className="sx-billInvoiceSub">{fmtDate(r.createdAt)}</div>
                    </div>


                    <div className="sx-billInvoiceRight">
                      <div className={`sx-billInvoiceStatus ${isArchived ? "is-arch" : isActive ? "is-good" : "is-watch"}`}>
                        {isArchived ? "archived" : r.status}
                      </div>


                      <div className="sx-billInvoiceAmt">{r.amount}</div>


                      <button
                        className={`sx-invDl ${!dl ? "is-disabled" : ""}`}
                        type="button"
                        disabled={!dl}
                        aria-disabled={!dl ? "true" : "false"}
                        title={dl ? "Download invoice" : "No download available yet"}
                        onClick={() => {
                          if (!dl) return;
                          window.open(dl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <DownloadIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="sx-billMini">No invoices yet.</div>
          )}
        </div>


        {toast ? (
          <div className="sx-billToast" data-tone={toast.tone} role="status" aria-live="polite">
            {toast.msg}
          </div>
        ) : null}
      </div>
    </section>
  );
}


export default function BillingClient() {
  if (!pk) {
    return (
      <section className="sx-panel" aria-label="Billing settings">
        <header className="sx-panelHead">
          <div>
            <h2 className="sx-h2">Billing</h2>
            <p className="sx-sub">Plan, subscription status, payment method, and invoices.</p>
          </div>
          <span className="sx-badge sx-badgeBill">Setup</span>
        </header>


        <div className="sx-body">
          <div className="sx-billError">
            Missing <b>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</b>. Add it to <b>.env.local</b> and restart <b>npm run dev</b>.
          </div>
        </div>
      </section>
    );
  }


  return <BillingClientInner />;
}

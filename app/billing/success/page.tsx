"use client";

import Link from "next/link";
import "../billing-result.css";
import { useEffect, useRef, useState } from "react";

type Phase = "processing" | "success";

type BillingSessionResponse = {
  ok?: boolean;
  plan?: string;
  billing?: string;
  paymentMethod?: string;
  invoicePdfUrl?: string;
  invoicePdf?: string;
  invoiceNumber?: string;
  createdAt?: string;
  currency?: string;
  amount?: number | string;
};

function cleanPayLabel(raw: string) {
  const v = String(raw || "").toLowerCase();
  if (v.includes("apple")) return "Apple Pay";
  if (v.includes("google")) return "Google Pay";
  if (v.includes("card")) return "Card";
  if (v.includes("link")) return "Link";
  return raw ? raw.replace(/_/g, " ") : "Card";
}

function PayBadge({ paymentMethod }: { paymentMethod: string }) {
  const v = String(paymentMethod || "").toLowerCase();
  const label = cleanPayLabel(paymentMethod);

  return (
    <span className={`pay-pill ${v.includes("apple") ? "is-apple" : v.includes("google") ? "is-gpay" : "is-card"}`}>
      {label}
    </span>
  );
}

function InvoiceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M6 2.8h12c.7 0 1.2.5 1.2 1.2v17.2l-2.1-1.2-2.1 1.2-2.1-1.2-2.1 1.2-2.1-1.2-2.1 1.2V4c0-.7.5-1.2 1.2-1.2Z"
        fill="currentColor"
        opacity="0.92"
      />
      <path
        d="M8.2 7.6h7.6M8.2 11.2h7.6M8.2 14.8h6.2"
        stroke="rgba(1,3,15,0.95)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}

export default function BillingSuccessPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const sessionId = String(searchParams?.session_id || "").trim();

  const [phase, setPhase] = useState<Phase>("processing");
  const [data, setData] = useState<BillingSessionResponse | null>(null);

  const didCelebrate = useRef(false);

  useEffect(() => {
    const sid = sessionId;
    if (!sid) return;

    let alive = true;

    async function load() {
      // Poll a bit — Stripe + invoice propagation can lag
      for (let i = 0; i < 18 && alive; i++) {
        try {
          const res = await fetch(`/api/billing/checkout-session?session_id=${encodeURIComponent(sid)}`, {
            cache: "no-store",
          });

          const json = await res.json().catch(() => null) as BillingSessionResponse | null;

          if (json?.ok) {
            setData(json);
            setTimeout(() => {
              if (!alive) return;
              setPhase("success");
            }, 650);
            return;
          }
        } catch {}

        await new Promise((r) => setTimeout(r, 850));
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Success chime + haptic (best-effort, non-blocking)
  useEffect(() => {
    if (phase !== "success") return;
    if (didCelebrate.current) return;
    didCelebrate.current = true;

    try {
      const navigatorWithVibrate = navigator as Navigator & {
        vibrate?: (pattern: number | number[]) => boolean;
      };
      navigatorWithVibrate.vibrate?.(18);
    } catch {}

    try {
      const win = window as Window & {
        AudioContext?: typeof window.AudioContext;
        webkitAudioContext?: typeof window.AudioContext;
      };
      const AC = win.AudioContext || win.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();

      o.type = "sine";
      o.frequency.value = 880;

      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(ctx.destination);

      o.start();

      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);

      setTimeout(() => {
        try {
          o.stop();
          ctx.close();
        } catch {}
      }, 220);
    } catch {}
  }, [phase]);

  const plan = String(data?.plan || "").toUpperCase();
  const billingCycle = String(data?.billing || "").toLowerCase(); // NEW
  const billingLabel = billingCycle.includes("annual") || billingCycle.includes("year") ? "Yearly" : "Monthly"; // NEW

  const paymentMethod = String(data?.paymentMethod || "card");
  const invoicePdfUrl = String(data?.invoicePdfUrl || data?.invoicePdf || "").trim();

  return (
    <main className={`pay-stage ${phase === "success" ? "is-success" : ""}`}>
      {/* BADGE */}
      <div
        className={[
          "pay-badgeWrap",
          phase === "processing" ? "cavbot-pay-processing" : "cavbot-pay-success",
        ].join(" ")}
      >
        <br /><br /> <div className="cavbot-badge-frame">
          <div className="cavbot-dm-avatar">
            <div className="cavbot-dm-avatar-core">
              <div className="cavbot-dm-face">
                <div className="cavbot-eyes-row">
                  <div className="cavbot-eye">
                    <div className="cavbot-eye-inner">
                      <div className="cavbot-eye-pupil" />
                    </div>
                    <div className="cavbot-eye-glow" />
                  </div>
                  <div className="cavbot-eye">
                    <div className="cavbot-eye-inner">
                      <div className="cavbot-eye-pupil" />
                    </div>
                    <div className="cavbot-eye-glow" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <br />

        {/* Small dock line under badge */}
        <div className="pay-dockline" aria-hidden="true" />
      </div>

      {/* PROCESSING COPY (UNCHANGED) */}
      {phase === "processing" && (
        <div className="pay-processing">
          <br />

          <h1>Processing your payment</h1>

          <br />
          <br />
        </div>
      )}

      {/* SUCCESS (REBUILT SPACING + BADGE PRESERVED) */}
      {phase === "success" && data && (
        <section className="pay-success" aria-label="Payment success">
          <br />

          <h1>Thank you for choosing CavBot</h1>

          <br />

          <p className="pay-sub">
            Your account has been upgraded to <b>{plan || "—"}</b>.
            <br />
            You’ll receive an email shortly with subscription details and your receipt.
          </p>

          <br />
          <br />

          <div className="pay-divider" aria-hidden="true" />

          <br />
          <br />

          <div className="pay-receipt" aria-label="Receipt">
            <div>
              <span>Invoice</span>
              <b>{data.invoiceNumber || "—"}</b>
              {invoicePdfUrl ? (
                <a
                  className="pay-invoiceDl"
                  href={invoicePdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Download invoice PDF"
                >
                  <InvoiceIcon />
                </a>
              ) : null}
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Date</span>
              <b>{data.createdAt ? new Date(data.createdAt).toLocaleDateString() : "—"}</b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Time</span>
              <b>{data.createdAt ? new Date(data.createdAt).toLocaleTimeString() : "—"}</b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Plan</span>
              <b>{plan || "—"}</b>
              <span aria-hidden="true" />
            </div>

            {/* NEW LINE: Billing cycle */}
            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Billing</span>
              <b>{billingLabel}</b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Payment</span>
              <PayBadge paymentMethod={paymentMethod} />
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Total</span>
              <b>
                ${data.amount ?? "—"} {String(data.currency || "USD").toUpperCase()}
              </b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Status</span>
              <b className="ok">Success</b>
              <span aria-hidden="true" />
            </div>
          </div>

          <br />
          <br />

          <div className="pay-actions">
            <Link href="/" className="pay-btn">
              Command Center
            </Link>
            <Link href="/integrate" className="pay-btn ghost">
              Integrating CavBot
            </Link>
          </div>

          <br />
        </section>
      )}
    </main>
  );
}

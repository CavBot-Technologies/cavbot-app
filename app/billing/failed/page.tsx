// app/billing/failed/page.tsx
"use client";

import "../billing-result.css";
import "./billing-failed.css";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Phase = "processing" | "failed";

type BillingSessionResponse = {
  ok?: boolean;
  status?: string;
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

export default function BillingFailedPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const sessionId = String(searchParams?.session_id || "").trim();

  const [phase, setPhase] = useState<Phase>("processing");
  const [data, setData] = useState<BillingSessionResponse | null>(null);

  const didBuzz = useRef(false);

  useEffect(() => {
    const sid = sessionId;
    if (!sid) return;

    let alive = true;

    async function load() {
      // Poll a bit — Stripe propagation can lag
      for (let i = 0; i < 18 && alive; i++) {
        try {
          const res = await fetch(`/api/billing/checkout-session?session_id=${encodeURIComponent(sid)}`, {
            cache: "no-store",
          });

          const json = (await res.json().catch(() => null)) as BillingSessionResponse | null;

          if (json?.ok) {
            // If it actually paid, go to the real success surface.
            if (String(json?.status || "").toLowerCase() === "paid") {
              window.location.href = `/billing/success?session_id=${encodeURIComponent(sid)}`;
              return;
            }

            setData(json);
            setTimeout(() => {
              if (!alive) return;
              setPhase("failed");
            }, 650);
            return;
          }
        } catch {}

        await new Promise((r) => setTimeout(r, 850));
      }

      // If Stripe never confirms, fail closed into the failed screen (no fake “success”).
      setTimeout(() => {
        if (!alive) return;
        setPhase("failed");
      }, 650);
    }

    load();

    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Failure haptic (best-effort, non-blocking)
  useEffect(() => {
    if (phase !== "failed") return;
    if (didBuzz.current) return;
    didBuzz.current = true;
    try {
      const navigatorWithVibrate = navigator as Navigator & {
        vibrate?: (pattern: number | number[]) => boolean;
      };
      navigatorWithVibrate.vibrate?.([12, 50, 12]);
    } catch {}
  }, [phase]);

  const plan = String(data?.plan || "").toUpperCase();
  const billing = String(data?.billing || "").toLowerCase();

  // NEW: real billing label
  const billingLabel = billing.includes("annual") || billing.includes("year") ? "Yearly" : "Monthly";

  const paymentMethod = String(data?.paymentMethod || "card");
  const invoicePdfUrl = String(data?.invoicePdfUrl || data?.invoicePdf || "").trim();

  const managePlansHref = `/plan${billing ? `?billing=${encodeURIComponent(billing)}` : ""}`;

  return (
    <main className={`pay-stage ${phase === "failed" ? "is-failed" : ""}`}>
      {/* BADGE */}
      <div
        className={[
          "pay-badgeWrap",
          phase === "processing" ? "cavbot-pay-processing" : "cavbot-pay-failed",
        ].join(" ")}
      >
        <div className="cavbot-badge-frame">
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

      {/* FAILED (SAME LAYOUT AS SUCCESS) */}
      {phase === "failed" && (
        <section className="pay-success" aria-label="Payment failed">
          <br />

          <h1>Payment failed</h1>

          <br />

          <p className="pay-sub">
            We couldn’t process your payment.
            <br />
            No charge was completed. You can try again, or manage your plan selection.
          </p>

          <br />
          <br />

          <div className="pay-divider" aria-hidden="true" />

          <br />
          <br />

          <div className="pay-receipt" aria-label="Receipt">
            <div>
              <span>Invoice</span>
              <b>{data?.invoiceNumber || "—"}</b>
              {invoicePdfUrl ? (
                <a
                  className="pay-invoiceDl"
                  href={invoicePdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open invoice"
                >
                  <InvoiceIcon />
                </a>
              ) : null}
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Date</span>
              <b>{data?.createdAt ? new Date(data.createdAt).toLocaleDateString() : "—"}</b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Time</span>
              <b>{data?.createdAt ? new Date(data.createdAt).toLocaleTimeString() : "—"}</b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Plan</span>
              <b>{plan || "—"}</b>
              <span aria-hidden="true" />
            </div>

            {/* NEW: Billing row (real data) */}
            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Billing</span>
              <b>{billingLabel}</b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Payment</span>
              <b>{cleanPayLabel(paymentMethod)}</b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Total</span>
              <b className="pay-amtMuted">
                ${data?.amount ?? "—"} {String(data?.currency || "USD").toUpperCase()}
              </b>
              <span aria-hidden="true" />
            </div>

            <div className="pay-rowGap" aria-hidden="true" />

            <div>
              <span>Status</span>
              <b className="bad">Failed</b>
              <span aria-hidden="true" />
            </div>
          </div>

          <br />
          <br />

          <div className="pay-actions">
            <Link href={managePlansHref} className="pay-btn">
              Manage Plans
            </Link>
            <Link href="/" className="pay-btn ghost">
              Command Center
            </Link>
          </div>

          <br />
        </section>
      )}
    </main>
  );
}

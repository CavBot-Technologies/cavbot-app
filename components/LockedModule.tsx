// /components/LockedModule.tsx
import Link from "next/link";
import { LockIcon } from "@/components/LockIcon";

type Bullet = {
  title: string;
  desc: string;
};

export default function LockedModule({
  moduleName,
  description,
  requiredPlanLabel = "Premium",
  primaryCtaHref = "/plan",
  secondaryCtaHref = "/console",
  primaryCtaLabel = "Upgrade Plan",
  secondaryCtaLabel = "Dashboard",
  bullets = [
    { title: "Deeper diagnostics", desc: "Unlock live grouping, stability signals, and trend visibility." },
    { title: "Actionable visibility", desc: "See repeat failures clearly, not scattered event noise." },
    { title: "Export-ready reporting", desc: "Generate shareable summaries for teams and stakeholders." },
  ],
}: {
  moduleName: string;
  description: string;
  requiredPlanLabel?: string;

  primaryCtaHref?: string;
  secondaryCtaHref?: string;
  primaryCtaLabel?: string;
  secondaryCtaLabel?: string;

  bullets?: Bullet[];
}) {
  return (
    <section className="cb-lock" aria-label={`${moduleName} locked`}>
      <div className="cb-lock-wrap">
        {/* LEFT: Core message */}
        <div className="cb-lock-card" role="region">
          <div className="cb-lock-head">
            <h1 className="cb-lock-title">{moduleName}</h1>
            <p className="cb-lock-sub">{description}</p>

            <div className="cb-lock-actions">
              <Link className="cb-lock-cta" href={primaryCtaHref}>
                {primaryCtaLabel} 
              </Link>

              <Link className="cb-lock-secondary" href={secondaryCtaHref}>
                {secondaryCtaLabel} 
              </Link>
            </div>
          </div>

          <div className="cb-lock-divider" aria-hidden="true" />

          {/* Bullets */}
          <div className="cb-lock-bullets" aria-label="What you unlock">
            {(bullets || []).slice(0, 3).map((b, i) => (
              <div key={i} className="cb-lock-bullet">
                <span className="cb-lock-dot" aria-hidden="true" />
                <div className="cb-lock-bulletText">
                  <div className="cb-lock-bulletTitle">{b.title}</div>
                  <div className="cb-lock-bulletDesc">{b.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="cb-lock-footnote">
            Upgrade anytime — your workspace remains intact. Only your capabilities expand.
          </div>
        </div>

        {/* RIGHT: Preview */}
        <div className="cb-lock-preview" aria-hidden="true">
          <div className="cb-lock-previewCard">
            <div className="cb-lock-previewTop">
              <div className="cb-lock-previewLabel">Preview</div>
              <div className="cb-lock-previewPill">Locked</div>
            </div>

            <div className="cb-lock-previewBody">
              <div className="cb-lock-previewPanel">
                <div className="cb-lock-previewRow" />
                <div className="cb-lock-previewRow w2" />
                <div className="cb-lock-previewRow w3" />
              </div>

              <div className="cb-lock-previewPanel">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="cb-lock-previewLine" />
                ))}
              </div>

              <div className="cb-lock-previewPanel tall">
                <div className="cb-lock-previewGraph" />
              </div>
            </div>

            <div className="cb-lock-previewOverlay">
              <div className="cb-lock-previewOverlayInner">
                <div className="cb-lock-lockMark" aria-hidden="true">
                  <LockIcon />
                </div>
                <div className="cb-lock-previewTitle">{requiredPlanLabel} required</div>
                <div className="cb-lock-previewSub">
                  Unlock full diagnostics + exports for this module.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        /* =========================================================
          CavBot Locked Module — Perfect Height Match + Premium Spacing
        ========================================================== */

     .cb-lock{
  position: relative;
  min-height: calc(100vh - 76px);
  display: flex;
  align-items: center;            
  padding: 20px 0 24px;
}


        .cb-lock-wrap{
          width: min(980px, calc(100% - 28px));
          margin: 0 auto;
          display:grid;
          grid-template-columns: 1fr 0.92fr;
          gap: 14px;

          /* THIS IS WHAT MAKES THEM THE SAME HEIGHT */
          align-items: stretch;
        }

        /* Shared spacing tokens */
        .cb-lock-card,
        .cb-lock-previewCard{
          --s1: 6px;
          --s2: 10px;
          --s3: 14px;
          --s4: 18px;
          --s5: 22px;
        }

        /* LEFT CARD */
        .cb-lock-card{
          height: 100%;
          display:flex;
          flex-direction: column;

          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.10);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.12)),
            radial-gradient(120% 120% at 0% 0%, rgba(120,140,255,0.10), rgba(255,255,255,0.02) 55%);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);

          /* Add premium breathing room */
          padding: 20px 20px 18px;
          overflow:hidden;

          /* Match the right card feel */
          min-height: 420px;
        }

     .cb-lock-head{
  display:flex;
  flex-direction: column;
  gap: 12px;
}

        .cb-lock-title{
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: rgba(247,251,255,0.96);
        }

        .cb-lock-sub{
          margin: 0;
          font-size: 12px;
          line-height: 1.45;
          color: rgba(197,206,231,0.86);
          max-width: 62ch;
        }

        .cb-lock-actions{
        margin-top: 20px;
          display:flex;
          gap: 10px;
          flex-wrap:wrap;

          /* Add breathing room under CTA row */
          padding-top: 2px;
        }

        .cb-lock-cta{
          height: 34px;
          padding: 0 14px;
          border-radius: 10px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap: 8px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          background: var(--lime);
          color: rgba(2,6,22,0.95);
          border: 1px solid rgba(255,255,255,0.18);
        }

        .cb-lock-secondary{
          height: 34px;
          padding: 0 14px;
          border-radius: 10px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap: 8px;
          font-size: 10px;
          font-weight: 750;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.14);
          color: rgba(247,251,255,0.92);
        }

        .cb-lock-divider{
          height: 1px;
          background: rgba(255,255,255,0.08);
          border-radius: 0;

          /* Slightly larger top spacing */
          margin: 18px -20px 30px;
        }

        .cb-lock-bullets{
          display:flex;
          flex-direction: column;

          /* Better block spacing */
          gap: 12px;
        }

        .cb-lock-bullet{
          display:flex;
          gap: 10px;
          align-items:flex-start;
          padding: 11px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.02);
        }

        .cb-lock-dot{
          width: 10px;
          height: 10px;
          margin-top: 4px;
          border-radius: 10px;
          background: rgba(185,200,90,0.95);
          flex: 0 0 auto;
        }

        .cb-lock-bulletTitle{
          font-size: 12px;
          font-weight: 800;
          color: rgba(247,251,255,0.94);
          letter-spacing: -0.01em;
        }

        .cb-lock-bulletDesc{
          margin-top: 2px;
          font-size: 12px;
          line-height: 1.35;
          color: rgba(197,206,231,0.82);
          max-width: 62ch;
        }

        /* Footnote stays at bottom to match the right height */
        .cb-lock-footnote{
          margin-top: auto;
          padding-top: 16px;
          font-size: 12px;
          color: rgba(197,206,231,0.72);
        }

        /* RIGHT PREVIEW */
        .cb-lock-preview{
          height: 100%;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.02);
          padding: 12px;

          /* no sticky here so height matches perfectly */
          position: relative;
        }

        .cb-lock-previewCard{
          height: 100%;
          position: relative;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.10);
          background:
            radial-gradient(120% 120% at 0% 0%,
              rgba(78,168,255,0.12),
              rgba(139,92,255,0.10) 46%,
              rgba(255,255,255,0.02) 100%
            );
          overflow:hidden;

          /* same baseline as left */
          min-height: 420px;
        }

        .cb-lock-previewTop{
          padding: 12px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }

        .cb-lock-previewLabel{
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(247,251,255,0.82);
        }

        .cb-lock-previewPill{
          height: 26px;
          padding: 0 10px;
          border-radius: 10px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.04);
          color: rgba(247,251,255,0.88);
        }

        .cb-lock-previewBody{
          padding: 12px;
          display:flex;
          flex-direction: column;
          gap: 10px;
          filter: blur(1.4px);
          opacity: 0.7;
        }

        .cb-lock-previewPanel{
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.02);
          padding: 12px;
        }

        .cb-lock-previewPanel.tall{
          min-height: 170px;
        }

        .cb-lock-previewRow{
          height: 12px;
          border-radius: 10px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          margin-bottom: 8px;
        }
        .cb-lock-previewRow.w2{ width: 82%; }
        .cb-lock-previewRow.w3{ width: 64%; margin-bottom: 0; }

        .cb-lock-previewLine{
          height: 10px;
          border-radius: 10px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          margin-bottom: 8px;
        }
        .cb-lock-previewLine:last-child{ margin-bottom: 0; }

        .cb-lock-previewGraph{
          height: 120px;
          border-radius: 14px;
          background:
            linear-gradient(90deg,
              rgba(185,200,90,0.12),
              rgba(78,168,255,0.10),
              rgba(139,92,255,0.12)
            );
          border: 1px solid rgba(255,255,255,0.08);
        }

        .cb-lock-previewOverlay{
          position:absolute;
          inset: 0;
          display:grid;
          place-items:center;
          background: rgba(1,3,15,0.32);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }

        .cb-lock-previewOverlayInner{
          width: min(320px, calc(100% - 34px));
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.03);
          padding: 14px;
          text-align:center;
        }

        .cb-lock-lockMark{
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display:grid;
          place-items:center;
          margin: 0 auto 8px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          color: rgba(247,251,255,0.92);
        }

        .cb-lock-previewTitle{
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(247,251,255,0.94);
        }

        .cb-lock-previewSub{
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.35;
          color: rgba(197,206,231,0.84);
        }

        /* Responsive */
        @media (max-width: 980px){
          .cb-lock-wrap{
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

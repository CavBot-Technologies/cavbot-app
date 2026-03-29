"use client";

import React from "react";

type CavBotLoadingScreenProps = {
  title: string;
  subtitle?: string;
  mode?: "processing" | "success";
  className?: string;
  greetingPhrases?: string[];
  greetingIntervalMs?: number;
};

export default function CavBotLoadingScreen({
  title,
  subtitle,
  mode = "processing",
  className,
  greetingPhrases,
  greetingIntervalMs,
}: CavBotLoadingScreenProps) {
  const [phraseIndex, setPhraseIndex] = React.useState(0);
  const hasGreetings = Boolean(greetingPhrases && greetingPhrases.length > 0);

  React.useEffect(() => {
    if (!hasGreetings || !greetingPhrases) return;
    setPhraseIndex(0);
    const interval = window.setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % greetingPhrases.length);
    }, greetingIntervalMs ?? 1000);
    return () => window.clearInterval(interval);
  }, [hasGreetings, greetingIntervalMs, greetingPhrases]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const prevDocOverflow = docEl.style.overflow;
    const prevBodyOverflow = bodyEl.style.overflow;
    const prevDocOverscroll = docEl.style.overscrollBehavior;
    const prevBodyOverscroll = bodyEl.style.overscrollBehavior;
    const prevDocTouch = docEl.style.touchAction;
    const prevBodyTouch = bodyEl.style.touchAction;
    const prevBodyHeight = bodyEl.style.height;

    window.scrollTo({ top: 0, left: 0 });
    docEl.style.overflow = "hidden";
    bodyEl.style.overflow = "hidden";
    docEl.style.overscrollBehavior = "none";
    bodyEl.style.overscrollBehavior = "none";
    docEl.style.touchAction = "none";
    bodyEl.style.touchAction = "none";
    bodyEl.style.height = "100%";

    return () => {
      docEl.style.overflow = prevDocOverflow;
      bodyEl.style.overflow = prevBodyOverflow;
      docEl.style.overscrollBehavior = prevDocOverscroll;
      bodyEl.style.overscrollBehavior = prevBodyOverscroll;
      docEl.style.touchAction = prevDocTouch;
      bodyEl.style.touchAction = prevBodyTouch;
      bodyEl.style.height = prevBodyHeight;
    };
  }, []);

  const headline = hasGreetings ? greetingPhrases![phraseIndex] : title;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pay-stage ${mode === "success" ? "is-success" : ""} ${className || ""} pay-stage--badge-center`}
    >
      <div className={`pay-badgeWrap ${mode === "processing" ? "cavbot-pay-processing" : "cavbot-pay-success"}`}>
        <div className="cb-badge cb-badge-inline" aria-hidden="true">
          <div className="cavbot-dm-avatar">
            <div className="cavbot-dm-avatar-core">
              <div className="cavbot-dm-face">
                <div className="cavbot-eyes-row">
                  <div className="cavbot-eye">
                    <div className="cavbot-eye-inner">
                      <div className="cavbot-eye-track">
                        <div className="cavbot-eye-pupil" />
                      </div>
                    </div>
                    <div className="cavbot-eye-glow" />
                    <div className="cavbot-blink" />
                  </div>
                  <div className="cavbot-eye">
                    <div className="cavbot-eye-inner">
                      <div className="cavbot-eye-track">
                        <div className="cavbot-eye-pupil" />
                      </div>
                    </div>
                    <div className="cavbot-eye-glow" />
                    <div className="cavbot-blink" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="pay-dockline" aria-hidden="true" />
      </div>

      <div className="pay-processing">
        <h1 className={hasGreetings ? "greeting" : ""}>{headline}</h1>
        {subtitle ? <p className="pay-sub">{subtitle}</p> : null}
      </div>
    </div>
  );
}

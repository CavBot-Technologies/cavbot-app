"use client";

import { useEffect, useRef } from "react";

const REDIRECT_TARGET = "/";

const shellStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 130001,
  background: "#000",
} as const;

const frameStyle = {
  display: "block",
  width: "100%",
  height: "100%",
  border: 0,
} as const;

export default function NotFoundArcadeClient({ src }: { src: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const maybePromoteRedirect = () => {
      try {
        if (!frame.contentWindow) return;
        const url = new URL(frame.contentWindow.location.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === REDIRECT_TARGET) {
          window.location.replace(REDIRECT_TARGET);
        }
      } catch {
        // Ignore cross-origin/transient iframe reads while nav is in-flight.
      }
    };

    frame.addEventListener("load", maybePromoteRedirect);
    const pollId = window.setInterval(maybePromoteRedirect, 250);

    return () => {
      frame.removeEventListener("load", maybePromoteRedirect);
      window.clearInterval(pollId);
    };
  }, []);

  return (
    <main
      id="main"
      style={shellStyle}
      data-cavbot-page-type="not-found"
      aria-label="Official Catch Cavbot 404 Game"
    >
      <iframe
        ref={frameRef}
        style={frameStyle}
        src={src}
        title="Official Catch Cavbot 404 Game"
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-popups-to-escape-sandbox"
      />
    </main>
  );
}

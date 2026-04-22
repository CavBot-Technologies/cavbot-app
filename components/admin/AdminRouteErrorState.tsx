"use client";

import { useEffect } from "react";

function getErrorMessage(error: Error & { digest?: string }) {
  const message = String(error?.message || "").trim();
  if (!message) return "CavBot HQ hit an unexpected error while loading this surface.";
  return message;
}

export default function AdminRouteErrorState(props: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref?: string;
  title?: string;
}) {
  useEffect(() => {
    console.error(props.error);
  }, [props.error]);

  const homeHref = props.homeHref || "/overview";
  const title = props.title || "HQ surface unavailable";
  const detail =
    process.env.NODE_ENV !== "production"
      ? getErrorMessage(props.error)
      : "The page failed while loading. Retry the route or return to the HQ home surface.";

  return (
    <main className="hq-routeErrorWrap">
      <section className="hq-routeErrorCard">
        <p className="hq-routeErrorEyebrow">CavBot HQ</p>
        <h1 className="hq-routeErrorTitle">{title}</h1>
        <p className="hq-routeErrorBody">{detail}</p>
        <div className="hq-routeErrorActions">
          <button className="hq-button" type="button" onClick={() => props.reset()}>
            Try again
          </button>
          <a className="hq-buttonGhost" href={homeHref}>
            Return home
          </a>
        </div>
      </section>
    </main>
  );
}

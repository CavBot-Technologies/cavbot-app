"use client";

import { useEffect, useState } from "react";
import { SERVICE_DEFINITIONS } from "@/lib/status/constants";
import type { ServiceKey } from "@/lib/status/types";

type Props = {
  services: ServiceKey[];
  title?: string;
};

export default function AffectedServicesPanel({ services, title }: Props) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.matchMedia("(min-width: 960px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 960px)");
    const apply = () => setOpen(mq.matches);
    const frame = requestAnimationFrame(apply);
    const handler = () => setOpen(mq.matches);
    mq.addEventListener("change", handler);

    return () => {
      mq.removeEventListener("change", handler);
      cancelAnimationFrame(frame);
    };
  }, []);

  const labels = services.length
    ? services.map((key) => SERVICE_DEFINITIONS[key]?.displayName ?? key)
    : ["No services listed"];

  return (
    <section className={`incident-affected-panel ${open ? "is-open" : "is-closed"}`}>
      <header className="incident-affected-header">
        {title ? (
          <h1 className="status-page-title incident-affected-title">{title}</h1>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={open ? "Hide affected services" : "Show affected services"}
          className="incident-affected-toggle"
        >
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 28 28"
            className="incident-affected-toggle-icon"
          >
            <path
              d="M3 14c0 1 .3 1.9.85 2.75C5.6 19.7 8.52 22 12 22s6.4-2.3 8.15-5.25A7.13 7.13 0 0 0 21 14c0-1-.3-1.9-.85-2.75C18.4 8.3 15.48 6 12 6s-6.4 2.3-8.15 5.25A7.13 7.13 0 0 0 3 14Zm9 5.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Zm0-2a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
              fill="currentColor"
            />
            <circle cx="12" cy="14" r="1.75" fill="#fff" opacity="0.9" />
          </svg>
        </button>
      </header>
      {open && (
        <div className="incident-affected-list">
          {labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
    </section>
  );
}

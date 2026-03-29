"use client";

import * as React from "react";

const DEFAULT_ITEMS = [
  { label: "Home", href: "/" },
  { label: "CavCode", href: "/cavcode" },
  { label: "CavCode Viewer", href: "/cavcode-viewer" },
  { label: "CavCloud", href: "/cavcloud" },
  { label: "CavTools", href: "/cavtools" },
];

export default function CavMobileMenu({
  items = DEFAULT_ITEMS,
  align = "left",
}: {
  items?: Array<{ label: string; href: string }>;
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (wrapRef.current && (wrapRef.current === t || wrapRef.current.contains(t))) return;
      setOpen(false);
    }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="cb-mobile-only" ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="cb-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open menu"
        onClick={() => setOpen((s) => !s)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open ? (
        <div className={`cb-menu ${align === "right" ? "cb-menu-right" : ""}`} role="menu" aria-label="Quick menu">
          {items.map((item) => (
            <a key={item.href} className="cb-menu-item" href={item.href} role="menuitem">
              {item.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

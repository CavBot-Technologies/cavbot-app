"use client";

import React from "react";

type CavCloudTextPreviewProps = {
  text: string;
  wrap?: boolean;
  showGrid?: boolean;
  className?: string;
};

function normalizeText(raw: string): string {
  return String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function CavCloudTextPreview(props: CavCloudTextPreviewProps) {
  const { text, wrap = false, showGrid = false, className = "" } = props;
  const normalized = React.useMemo(() => normalizeText(text), [text]);
  const lines = React.useMemo(() => normalized.split("\n"), [normalized]);
  const lineDigits = React.useMemo(() => Math.max(2, String(lines.length || 1).length), [lines.length]);
  const surfaceStyle = React.useMemo(
    () => ({ "--cc-preview-line-digits": String(lineDigits) }) as React.CSSProperties,
    [lineDigits]
  );

  const rootClass = `cc-previewTextSurface ${wrap ? "is-wrap" : "is-nowrap"} ${showGrid ? "is-grid" : ""} ${className}`.trim();

  return (
    <div className={rootClass} style={surfaceStyle} aria-label="File content">
      <div className="cc-previewTextRows">
        {lines.map((line, idx) => (
          <div className="cc-previewTextRow" key={idx}>
            <span className="cc-previewTextLineNo" aria-hidden="true">{idx + 1}</span>
            <span className="cc-previewTextLine">{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

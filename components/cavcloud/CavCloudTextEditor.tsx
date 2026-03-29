"use client";

import React from "react";

type CavCloudTextEditorProps = {
  value: string;
  wrap?: boolean;
  showGrid?: boolean;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
  onEscape?: () => void;
};

const TAB_TEXT = "  ";

export function CavCloudTextEditor(props: CavCloudTextEditorProps) {
  const { value, wrap = false, showGrid = false, disabled = false, onChange, onEscape } = props;
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  const editorClass = `cc-previewTextEditor ${showGrid ? "is-grid" : ""}`.trim();

  const onKeyDown = React.useCallback((ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === "Tab") {
      ev.preventDefault();
      const el = ref.current;
      if (!el) return;

      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      const current = el.value;
      const next = `${current.slice(0, start)}${TAB_TEXT}${current.slice(end)}`;
      onChange(next);

      window.requestAnimationFrame(() => {
        if (!ref.current) return;
        const caret = start + TAB_TEXT.length;
        ref.current.selectionStart = caret;
        ref.current.selectionEnd = caret;
      });
      return;
    }

    if (ev.key === "Escape" && onEscape) {
      ev.preventDefault();
      onEscape();
    }
  }, [onChange, onEscape]);

  return (
    <textarea
      ref={ref}
      className={editorClass}
      value={value}
      wrap={wrap ? "soft" : "off"}
      spellCheck={false}
      disabled={disabled}
      onChange={(ev) => onChange(ev.currentTarget.value)}
      onKeyDown={onKeyDown}
      aria-label="Edit file content"
    />
  );
}

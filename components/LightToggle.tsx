// components/LightToggle.tsx
"use client";

import { useId, useState } from "react";

type LightToggleSize = "sm" | "md" | "lg";

type LightToggleProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (next: boolean) => void;
  disabled?: boolean;

  /**
   * Accessible label for screen readers if you are not rendering visible text.
   * If you render visible text, prefer aria-labelledby instead.
   */
  "aria-label"?: string;
  "aria-labelledby"?: string;

  size?: LightToggleSize;
  className?: string;
  id?: string;
  title?: string;
};

function cx(...parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join(" ");
}

export default function LightToggle(props: LightToggleProps) {
  const {
    checked: checkedProp,
    defaultChecked,
    onCheckedChange,
    disabled,
    size: sizeProp,
    className,
    id: idProp,
    title,
  } = props;

  const autoId = useId();
  const id = idProp || `cb-lighttoggle-${autoId}`;

  const isControlled = typeof checkedProp === "boolean";
  const [uncontrolled, setUncontrolled] = useState<boolean>(!!defaultChecked);
  const checked = isControlled ? !!checkedProp : uncontrolled;

  const size = sizeProp || "md";
  const stateClass = checked ? "is-on" : "is-off";

  // Prefer explicit aria-label/labelledby. Fall back to title. Last resort is a generic label.
  const ariaLabel = props["aria-label"] || title || "Toggle";
  const ariaLabelledBy = props["aria-labelledby"];
  const a11y = {
    "aria-label": ariaLabelledBy ? undefined : ariaLabel,
    "aria-labelledby": ariaLabelledBy,
  } as const;

  const onToggle = () => {
    if (disabled) return;
    const next = !checked;
    if (!isControlled) setUncontrolled(next);
    onCheckedChange?.(next);
  };

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      className={cx("cb-lightToggle", `cb-lightToggle--${size}`, stateClass, className)}
      data-state={checked ? "on" : "off"}
      onClick={onToggle}
      {...a11y}
    >
      <span className="cb-lightToggle__glow" aria-hidden="true" />

      <svg className="cb-lightToggle__trace" viewBox="0 0 100 100" aria-hidden="true">
        {/* Normalize perimeter length so dash animations stay consistent across sizes. */}
        <rect x="9" y="9" width="82" height="82" rx="18" pathLength="100" />
      </svg>

      <span className="cb-lightToggle__icon" aria-hidden="true">
        {/* "Power" glyph (simple, readable at 16-20px). */}
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M12 2.6a1 1 0 0 1 1 1v8.2a1 1 0 1 1-2 0V3.6a1 1 0 0 1 1-1Z"
            fill="currentColor"
          />
          <path
            d="M7.2 5.8a1 1 0 0 1 .1 1.4A7 7 0 1 0 16.7 7.2a1 1 0 1 1 1.5-1.3A9 9 0 1 1 5.8 7.3a1 1 0 0 1 1.4-1.5Z"
            fill="currentColor"
            opacity="0.92"
          />
        </svg>
      </span>
    </button>
  );
}

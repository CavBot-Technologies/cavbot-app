import type { SVGProps } from "react";

type Props = Omit<SVGProps<SVGSVGElement>, "children"> & {
  shown: boolean;
  size?: number;
};

export function PasswordVisibilityIcon({ shown, size = 18, ...props }: Props) {
  const eyePath =
    "M0 8L3.07945 4.30466C4.29638 2.84434 6.09909 2 8 2C9.90091 2 11.7036 2.84434 12.9206 4.30466L16 8L12.9206 11.6953C11.7036 13.1557 9.90091 14 8 14C6.09909 14 4.29638 13.1557 3.07945 11.6953L0 8ZM8 11C9.65685 11 11 9.65685 11 8C11 6.34315 9.65685 5 8 5C6.34315 5 5 6.34315 5 8C5 9.65685 6.34315 11 8 11Z";

  if (shown) {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" {...props}>
        <path d={eyePath} fill="currentColor" />
        <path
          d="M2.25 2.25L13.75 13.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.45"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" {...props}>
      <path d={eyePath} fill="currentColor" />
    </svg>
  );
}

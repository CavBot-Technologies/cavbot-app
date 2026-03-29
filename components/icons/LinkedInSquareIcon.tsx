import type { SVGProps } from "react";

type Props = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
};

/**
 * CavBot-styled LinkedIn mark:
 * White square + blue "in" (no external dependencies, deterministic rendering).
 */
export function LinkedInSquareIcon({ size = 16, ...props }: Props) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} focusable="false" aria-hidden="true" {...props}>
      {/* Slight inset so the filled mark doesn't read "bigger" than line icons around it. */}
      <g transform="translate(1.7 1.7) scale(0.86)">
        <rect x="0" y="0" width="24" height="24" rx="5.4" fill="#ffffff" />
        {/* LinkedIn "in" glyph only (outer square removed) */}
        <path
          // Corporate LinkedIn blue (darker, less neon than the app accent blue).
          fill="#0A66C2"
          d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.777 13.019H3.56V9h3.554v11.452z"
        />
      </g>
    </svg>
  );
}

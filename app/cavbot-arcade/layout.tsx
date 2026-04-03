import type { ReactNode } from "react";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function CavbotArcadeLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}

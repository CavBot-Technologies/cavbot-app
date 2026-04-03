// app/cavbot/page.tsx
//
// Keep /cavbot as a first-class public route, but render the canonical
// public profile surface instead of aliasing to the command center.

import PublicCavbotProfilePage from "../u/[username]/page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function CavbotProfileAliasPage({
  searchParams,
}: {
  searchParams?: { view?: string | string[] };
}) {
  return <PublicCavbotProfilePage params={{ username: "cavbot" }} searchParams={searchParams} />;
}

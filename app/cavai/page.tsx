import type { Metadata } from "next";
import { CAVAI_CANONICAL_ORIGIN } from "@/lib/cavai/url";
import CavAiPageClient from "./CavAiPageClient";

const CAVAI_MARKETING_TITLE = "CavAi • Smart, Structured AI for Operators";
const CAVAI_MARKETING_DESCRIPTION =
  "CavAi is CavBot’s AI assistant for serious work. Think clearly, solve faster, write better, and move from idea to execution with AI built for modern digital systems.";

export const metadata: Metadata = {
  title: {
    absolute: CAVAI_MARKETING_TITLE,
  },
  description: CAVAI_MARKETING_DESCRIPTION,
  alternates: {
    canonical: CAVAI_CANONICAL_ORIGIN,
  },
  openGraph: {
    title: CAVAI_MARKETING_TITLE,
    description: CAVAI_MARKETING_DESCRIPTION,
    url: CAVAI_CANONICAL_ORIGIN,
  },
  twitter: {
    title: CAVAI_MARKETING_TITLE,
    description: CAVAI_MARKETING_DESCRIPTION,
  },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function CavAiPage() {
  return <CavAiPageClient />;
}

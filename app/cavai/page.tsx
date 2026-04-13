import type { Metadata } from "next";
import { redirect } from "next/navigation";
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

function readParam(
  value: string | string[] | undefined
): string {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

export default function CavAiPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const searchParams = props.searchParams || {};
  const surface = readParam(searchParams.surface).toLowerCase();

  if (surface === "cavcode") {
    const qp = new URLSearchParams();
    qp.set("cavai", "1");

    const rawProjectId = readParam(searchParams.projectId) || readParam(searchParams.project);
    const projectId = Number(rawProjectId);
    if (Number.isFinite(projectId) && projectId > 0) {
      qp.set("projectId", String(Math.trunc(projectId)));
    }

    const filePath = readParam(searchParams.filePath) || readParam(searchParams.file);
    if (filePath) qp.set("file", filePath);

    redirect(`/cavcode?${qp.toString()}`);
  }

  return <CavAiPageClient />;
}

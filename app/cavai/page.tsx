import { redirect } from "next/navigation";
import CavAiPageClient from "./CavAiPageClient";

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

import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getSession } from "@/lib/apiAuth";
import { isBasicUsername, normalizeUsername } from "@/lib/username";
import { resolvePublicArtifactScope } from "@/lib/publicProfile/publicArtifacts.server";

import { PublicArtifactViewerClient } from "./PublicArtifactViewerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getViewerUserIdSafe(): Promise<string | null> {
  try {
    const h = headers();
    const cookie = String(h.get("cookie") || "").trim();
    if (!cookie) return null;

    // getSession() only needs incoming cookies; use a fixed internal URL
    // so host/header spoofing cannot influence session reads.
    const req = new Request("https://app.cavbot.internal/_public_artifact_viewer", {
      headers: {
        cookie,
      },
    });

    const sess = await getSession(req);
    if (!sess || sess.systemRole !== "user") return null;

    const uid = String(sess.sub || "").trim();
    if (!uid || uid === "system") return null;
    return uid;
  } catch {
    return null;
  }
}

export default async function PublicArtifactViewerPage({
  params,
}: {
  params: { username: string; artifactId: string };
}) {
  const username = normalizeUsername(params?.username || "");
  const artifactId = String(params?.artifactId || "").trim();
  if (!username || !isBasicUsername(username) || !artifactId) notFound();

  const scope = await resolvePublicArtifactScope({ username, artifactId });
  if (!scope) notFound();

  const viewerUserId = await getViewerUserIdSafe();
  const isOwner = Boolean(viewerUserId) && viewerUserId === scope.ownerUserId;

  return (
    <PublicArtifactViewerClient
      username={scope.username}
      artifactId={scope.id}
      title={scope.displayTitle}
      type={scope.type}
      sourcePath={scope.sourcePath}
      mimeType={scope.mimeType}
      sizeBytes={scope.sizeBytes}
      isOwner={isOwner}
      rootPath={scope.rootFolder?.path || scope.sourcePath || "/"}
    />
  );
}

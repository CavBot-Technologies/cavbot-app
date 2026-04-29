import "server-only";

import { decryptAesGcm } from "@/lib/cryptoAesGcm.server";

type ProjectKeyRecord = {
  id: number;
  serverKeyEnc?: string | null;
  serverKeyEncIv?: string | null;
};

type ProjectAnalyticsAuth =
  | { projectKey: string; adminToken?: undefined; source: "project_encrypted" | "legacy_env" }
  | { projectKey?: undefined; adminToken: string; source: "admin_token" };

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function legacyProjectId() {
  const raw = env("CAVBOT_LEGACY_ANALYTICS_PROJECT_ID") || env("CAVBOT_DEFAULT_PROJECT_ID") || "1";
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function legacyServerKeyForProject(projectId: number) {
  if (projectId !== legacyProjectId()) return "";
  return env("CAVBOT_SECRET_KEY") || env("CAVBOT_PROJECT_KEY");
}

export async function resolveProjectAnalyticsAuth(project: ProjectKeyRecord): Promise<ProjectAnalyticsAuth> {
  if (project.serverKeyEnc && project.serverKeyEncIv) {
    const projectKey = String(
      await decryptAesGcm({
        enc: project.serverKeyEnc,
        iv: project.serverKeyEncIv,
      }),
    ).trim();
    if (!projectKey) throw new Error("PROJECT_KEY_DECRYPT_FAILED");
    return { projectKey, source: "project_encrypted" as const };
  }

  const adminToken = env("CAVBOT_ADMIN_TOKEN");
  if (adminToken) return { adminToken, source: "admin_token" };

  const fallback = legacyServerKeyForProject(project.id);
  if (fallback) return { projectKey: fallback, source: "legacy_env" as const };

  throw new Error("PROJECT_KEY_MISSING");
}

export async function resolveProjectAnalyticsKey(project: ProjectKeyRecord) {
  const auth = await resolveProjectAnalyticsAuth(project);
  if (auth.projectKey) return { projectKey: auth.projectKey, source: auth.source };
  throw new Error("PROJECT_KEY_MISSING");
}

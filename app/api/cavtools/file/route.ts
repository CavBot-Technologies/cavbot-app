import { NextResponse } from "next/server";

import { maybeReadRuntimeCavtoolsFile } from "@/lib/cavtools/runtimePlane.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function normalizeRuntimeFailureMessage(raw: string) {
  const message = String(raw || "").trim();
  if (message.includes('Dynamic require of "node:child_process" is not supported')) {
    return {
      code: "PROCESS_RUNTIME_UNAVAILABLE",
      message: "This CavTools action requires a full Node runtime and is unavailable in the current deployment surface.",
    };
  }
  if (message.includes("WebAssembly.Module(): Wasm code generation disallowed by embedder")) {
    return {
      code: "CAVTOOLS_RUNTIME_UNAVAILABLE",
      message: "This CavTools file surface is unavailable in the current deployment runtime.",
    };
  }
  return {
    code: "INTERNAL",
    message: message || "Failed to read file.",
  };
}

function parseProjectId(raw: string | null): number | null {
  const n = Number(String(raw || "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const path = String(url.searchParams.get("path") || "").trim();
    const projectId = parseProjectId(url.searchParams.get("projectId"));
    const siteOrigin = String(url.searchParams.get("siteOrigin") || "").trim() || null;

    if (!path) {
      return jsonNoStore({ ok: false, error: { code: "PATH_REQUIRED", message: "path is required." } }, 400);
    }

    const runtimeFile = await maybeReadRuntimeCavtoolsFile(req, {
      path,
      projectId,
      siteOrigin,
    });
    if (runtimeFile) {
      return jsonNoStore(runtimeFile, 200);
    }

    const { readCavtoolsFile } = await import("@/lib/cavtools/commandPlane.server");

    const out = await readCavtoolsFile(req, {
      path,
      projectId,
      siteOrigin,
    });

    return jsonNoStore(out, 200);
  } catch (error) {
    const code = String((error as { code?: unknown })?.code || "").trim();
    const statusRaw = Number((error as { status?: unknown })?.status || 500);
    const status = Number.isFinite(statusRaw) ? statusRaw : 500;
    const normalized = normalizeRuntimeFailureMessage(error instanceof Error ? error.message : "Failed to read file.");
    return jsonNoStore({ ok: false, error: { code: code || normalized.code, message: normalized.message } }, status);
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await readSanitizedJson(req, null)) as
      | null
      | {
          path?: string | null;
          content?: string | null;
          mimeType?: string | null;
          baseSha256?: string | null;
          projectId?: number | string | null;
          siteOrigin?: string | null;
        };

    if (!body) {
      return jsonNoStore({ ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON body." } }, 400);
    }

    const path = String(body.path || "").trim();
    if (!path) {
      return jsonNoStore({ ok: false, error: { code: "PATH_REQUIRED", message: "path is required." } }, 400);
    }

    const { writeCavtoolsFile } = await import("@/lib/cavtools/commandPlane.server");

    const out = await writeCavtoolsFile(req, {
      path,
      content: String(body.content || ""),
      mimeType: body.mimeType || null,
      baseSha256: body.baseSha256 || null,
      projectId: body.projectId,
      siteOrigin: body.siteOrigin || null,
    });

    return jsonNoStore(out, 200);
  } catch (error) {
    const code = String((error as { code?: unknown })?.code || "INTERNAL").trim();
    if (code === "FILE_EDIT_CONFLICT") {
      const latestSha256 = String((error as { latestSha256?: unknown })?.latestSha256 || "").trim() || null;
      const latestVersionRaw = Number((error as { latestVersionNumber?: unknown })?.latestVersionNumber);
      const latestVersionNumber = Number.isFinite(latestVersionRaw) ? Math.max(1, Math.trunc(latestVersionRaw)) : null;
      return jsonNoStore({
        ok: false,
        error: {
          code: "FILE_EDIT_CONFLICT",
          message: "File changed since your last read.",
          latest: {
            sha256: latestSha256,
            versionNumber: latestVersionNumber,
          },
        },
      }, 409);
    }
    const statusRaw = Number((error as { status?: unknown })?.status || 500);
    const status = Number.isFinite(statusRaw) ? statusRaw : 500;
    const message = error instanceof Error ? error.message : "Failed to write file.";
    return jsonNoStore({ ok: false, error: { code, message } }, status);
  }
}

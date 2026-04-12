import { NextResponse } from "next/server";

import { ApiAuthError } from "@/lib/apiAuth";
import { maybeHandleRuntimeExecCommand } from "@/lib/cavtools/runtimePlane.server";
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
      message: "This CavTools command requires a full Node runtime and is unavailable in the current deployment surface.",
    };
  }
  if (message.includes("WebAssembly.Module(): Wasm code generation disallowed by embedder")) {
    return {
      code: "CAVTOOLS_RUNTIME_UNAVAILABLE",
      message: "This CavTools action is unavailable in the current deployment runtime.",
    };
  }
  return {
    code: "INTERNAL",
    message: message || "Failed to execute command.",
  };
}

export async function POST(req: Request) {
  try {
    const body = (await readSanitizedJson(req, null)) as
      | null
      | {
          cwd?: string | null;
          command?: string | null;
          projectId?: number | string | null;
          siteOrigin?: string | null;
          sessionId?: string | null;
        };

    if (!body) {
      return jsonNoStore({ ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON body." } }, 400);
    }

    const command = String(body.command || "").trim();
    if (!command) {
      return jsonNoStore({ ok: false, error: { code: "COMMAND_REQUIRED", message: "command is required." } }, 400);
    }

    const runtimeResult = await maybeHandleRuntimeExecCommand(req, {
      cwd: body.cwd,
      command,
      projectId: body.projectId,
      siteOrigin: body.siteOrigin,
      path: null,
    });
    if (runtimeResult) {
      return jsonNoStore(runtimeResult, 200);
    }

    const { executeCavtoolsCommand } = await import("@/lib/cavtools/commandPlane.server");

    const result = await executeCavtoolsCommand(req, {
      cwd: body.cwd,
      command,
      projectId: body.projectId,
      siteOrigin: body.siteOrigin,
      sessionId: body.sessionId,
    });

    return jsonNoStore(result, 200);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return jsonNoStore(
        {
          ok: false,
          cwd: "/cavcloud",
          command: "",
          warnings: [],
          blocks: [
            {
              kind: "text",
              title: "Command Blocked",
              lines: [error.code === "FORBIDDEN" ? "Access denied." : "Authentication required."],
            },
          ],
          durationMs: 0,
          audit: {
            commandId: "exec_route_auth",
            atISO: new Date().toISOString(),
            denied: true,
          },
          error: {
            code: error.code,
            message: error.code === "FORBIDDEN" ? "Access denied." : "Authentication required.",
          },
        },
        error.status
      );
    }
    const normalized = normalizeRuntimeFailureMessage(error instanceof Error ? error.message : "Failed to execute command.");
    return jsonNoStore(
      {
        ok: false,
        cwd: "/cavcloud",
        command: "",
        warnings: [],
        blocks: [
          {
            kind: "text",
            title: "Command Failed",
            lines: [normalized.message],
          },
        ],
        durationMs: 0,
        audit: {
          commandId: "exec_route_error",
          atISO: new Date().toISOString(),
          denied: false,
        },
        error: {
          code: normalized.code,
          message: normalized.message,
        },
      },
      200
    );
  }
}

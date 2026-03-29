import { NextResponse } from "next/server";

import { executeCavtoolsCommand } from "@/lib/cavtools/commandPlane.server";
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

    const result = await executeCavtoolsCommand(req, {
      cwd: body.cwd,
      command,
      projectId: body.projectId,
      siteOrigin: body.siteOrigin,
      sessionId: body.sessionId,
    });

    return jsonNoStore(result, result.ok ? 200 : 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to execute command.";
    return jsonNoStore({ ok: false, error: { code: "INTERNAL", message } }, 500);
  }
}

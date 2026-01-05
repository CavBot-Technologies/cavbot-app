// app/api/summary/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession } from "@/lib/apiAuth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function mustEnv(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

function readEnv(...names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] ?? "").trim();
    if (v) return v;
  }
  return "";
}

export async function GET(req: Request) {
  try {
    // 1) Auth + account context
    const session = await requireSession(req);
    requireAccountContext(session);

    // 2) Find the requested project in your Prisma DB (this is your "console app" world)
    const { searchParams } = new URL(req.url);

    const projectIdRaw = (searchParams.get("projectId") ?? "").trim();
    const projectSlug = (searchParams.get("projectSlug") ?? "").trim();

    let project: any = null;

    if (projectIdRaw) {
      const pid = Number(projectIdRaw);
      if (!Number.isFinite(pid)) {
        return NextResponse.json({ ok: false, error: "projectId must be a number" }, { status: 400 });
      }
      project = await prisma.project.findFirst({
        where: { id: pid, accountId: session.accountId!, isActive: true },
      });
    } else if (projectSlug) {
      project = await prisma.project.findFirst({
        where: { slug: projectSlug, accountId: session.accountId!, isActive: true },
      });
    } else {
      project = await prisma.project.findFirst({
        where: { accountId: session.accountId!, isActive: true },
        orderBy: { createdAt: "asc" },
      });
    }

    if (!project) {
      return NextResponse.json({ ok: false, error: "project_not_found" }, { status: 404 });
    }

    // 3) Analytics Worker config (this is your "analytics world")
    // Base URL: prefer server-only var, fallback to NEXT_PUBLIC if needed
    const apiBase =
      readEnv("CAVBOT_API_BASE_URL", "CAVBOT_API_BASE", "NEXT_PUBLIC_CAVBOT_API_BASE") ||
      "https://api.cavbot.io";

    // IMPORTANT: This must be a SECRET in Cloudflare Pages (cavbot-app)
    // Do NOT use a NEXT_PUBLIC key for this server call.
    const projectKey = mustEnv("CAVBOT_PROJECT_KEY");

    const range = (searchParams.get("range") ?? "30d").trim() || "30d";

    // 4) Call the Worker with X-Project-Key so it never hits legacy_requires_project_key
    const url = new URL(`/v1/projects/${encodeURIComponent(String(project.id))}/summary`, apiBase);
    url.searchParams.set("range", range);

    // Optional: if you ever add origin filtering in the worker for server calls,
    // you can pass an origin to filter by site:
    // const origin = (searchParams.get("origin") ?? "").trim();
    // if (origin) url.searchParams.set("origin", origin);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Project-Key": projectKey,
        // (Optional) if you ever want admin-mode reads:
        // "X-Admin-Token": mustEnv("CAVBOT_ADMIN_TOKEN"),
      },
      cache: "no-store",
    });

    const text = await res.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { ok: false, error: "bad_json_from_analytics", raw: text?.slice(0, 300) };
    }

    if (!res.ok) {
      // Preserve worker status + message so debugging is clean
      return NextResponse.json(
        {
          ok: false,
          error: "analytics_summary_failed",
          status: res.status,
          analytics: payload,
        },
        { status: res.status }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        project: { id: project.id, slug: project.slug, name: project.name },
        data: payload,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = String(e?.message || e);

    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // Helpful env error
    if (msg.startsWith("missing_env:")) {
      return NextResponse.json(
        {
          ok: false,
          error: "server_misconfigured",
          message: msg,
          hint:
            "Set this variable in Cloudflare Pages (cavbot-app) → Settings → Variables and Secrets (Production).",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: false, error: "summary_proxy_failed", message: msg },
      { status: 500 }
    );
  }
}

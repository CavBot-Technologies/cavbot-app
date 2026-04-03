import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { readImageHistory } from "@/lib/cavai/imageStudio.server";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(96, Math.trunc(parsed)));
}

function parseView(value: unknown): "recent" | "saved" | "history" {
  const view = s(value).toLowerCase();
  if (view === "saved") return "saved";
  if (view === "history") return "history";
  return "recent";
}

export async function GET(req: Request) {
  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const url = new URL(req.url);
    const view = parseView(url.searchParams.get("view"));

    try {
      const limit = toLimit(url.searchParams.get("limit"));
      const rows = await readImageHistory({
        accountId: ctx.accountId,
        userId: ctx.userId,
        view,
        limit,
      });
      return jsonNoStore(
        {
          ok: true,
          view,
          rows,
        },
        200
      );
    } catch {
      return jsonNoStore(
        {
          ok: true,
          degraded: true,
          view,
          rows: [],
        },
        200
      );
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load Image Studio history.");
  }
}

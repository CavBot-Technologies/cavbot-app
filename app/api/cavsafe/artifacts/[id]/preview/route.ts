import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function copyHeader(from: Request, to: Headers, name: string) {
  const value = s(from.headers.get(name));
  if (value) to.set(name, value);
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const id = s(ctx?.params?.id);
    if (!id) {
      return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);
    }

    const upstreamUrl = new URL(req.url);
    upstreamUrl.pathname = `/api/cavsafe/files/${encodeURIComponent(id)}`;
    upstreamUrl.searchParams.set("raw", "1");
    if (upstreamUrl.searchParams.get("download") === "1") {
      upstreamUrl.searchParams.set("download", "1");
    } else {
      upstreamUrl.searchParams.delete("download");
    }

    const forward = new Headers();
    copyHeader(req, forward, "cookie");
    copyHeader(req, forward, "range");
    copyHeader(req, forward, "if-none-match");
    copyHeader(req, forward, "if-modified-since");
    copyHeader(req, forward, "origin");
    copyHeader(req, forward, "referer");
    copyHeader(req, forward, "user-agent");

    const upstream = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: forward,
      redirect: "follow",
      cache: "no-store",
    });

    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "private, no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to stream CavSafe artifact preview.");
  }
}

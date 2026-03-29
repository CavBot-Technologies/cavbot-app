import { readCavcodeEventsSnapshot } from "@/lib/cavtools/commandPlane.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STREAM_TICK_MS = 900;
const STREAM_MAX_MS = 10 * 60 * 1000;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function parseProjectId(value: string | null): number | null {
  const n = Number(s(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return Math.trunc(n);
}

function parseAfterSeq(value: string | null): number {
  const n = Number(s(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function parseLimit(value: string | null): number {
  const n = Number(s(value));
  if (!Number.isFinite(n)) return 120;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.trunc(ms)));
  });
}

function toSseChunk(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "CavCode event stream failed.";
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  const url = new URL(req.url);
  const query = {
    projectId: parseProjectId(url.searchParams.get("projectId")),
    siteOrigin: s(url.searchParams.get("siteOrigin")) || null,
    afterSeq: parseAfterSeq(url.searchParams.get("afterSeq")),
    limit: parseLimit(url.searchParams.get("limit")),
  };

  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(toSseChunk(event, payload)));
        } catch {
          closed = true;
        }
      };

      const onAbort = () => {
        close();
      };
      req.signal.addEventListener("abort", onAbort, { once: true });

      void (async () => {
        let afterSeq = query.afterSeq;
        const startedAt = Date.now();
        try {
          while (!closed) {
            if (Date.now() - startedAt > STREAM_MAX_MS) {
              send("cavcode_end", { reason: "timeout", nextSeq: afterSeq });
              break;
            }

            const snapshot = await readCavcodeEventsSnapshot(req, {
              projectId: query.projectId,
              siteOrigin: query.siteOrigin,
              afterSeq,
              limit: query.limit,
            });
            const nextSeq = Number.isFinite(Number(snapshot.nextSeq))
              ? Math.max(0, Math.trunc(Number(snapshot.nextSeq)))
              : afterSeq;
            const events = Array.isArray(snapshot.events) ? snapshot.events : [];
            if (events.length) {
              send("cavcode_events", {
                type: "cavcode_events_v1",
                projectId: snapshot.projectId,
                afterSeq,
                nextSeq,
                events,
              });
            } else {
              send("cavcode_heartbeat", {
                type: "cavcode_heartbeat_v1",
                projectId: snapshot.projectId,
                nextSeq,
              });
            }
            afterSeq = Math.max(afterSeq, nextSeq);
            await sleep(STREAM_TICK_MS);
          }
        } catch (error) {
          send("cavcode_error", { message: toErrorMessage(error), nextSeq: afterSeq });
        } finally {
          req.signal.removeEventListener("abort", onAbort);
          close();
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

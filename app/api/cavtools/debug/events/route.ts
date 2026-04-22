export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STREAM_TICK_MS = 700;
const STREAM_MAX_MS = 10 * 60 * 1000;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function parseProjectId(value: string | null): number | null {
  const parsed = Number(s(value));
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function parseAfterSeq(value: string | null): number {
  const parsed = Number(s(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function isDebugActive(status: string): boolean {
  return status === "starting" || status === "running" || status === "paused";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Debug stream failed.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.trunc(ms)));
  });
}

function toSseChunk(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function debugRouteEnabled() {
  if (process.env.NODE_ENV !== "production") return true;
  return String(process.env.CAVBOT_ENABLE_DRIVE_DEBUG_ROUTE || "").trim() === "1";
}

export async function GET(req: Request) {
  if (!debugRouteEnabled()) {
    return new Response(JSON.stringify({ ok: false, error: "NOT_FOUND" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  const encoder = new TextEncoder();
  const url = new URL(req.url);
  const query = {
    sessionId: s(url.searchParams.get("sessionId")) || null,
    projectId: parseProjectId(url.searchParams.get("projectId")),
    siteOrigin: s(url.searchParams.get("siteOrigin")) || null,
    afterSeq: parseAfterSeq(url.searchParams.get("afterSeq")),
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
        let lastStatusSignature = "";
        const startedAt = Date.now();

        try {
          while (!closed) {
            if (Date.now() - startedAt > STREAM_MAX_MS) {
              send("debug_end", { reason: "timeout" });
              break;
            }

            const { readCavtoolsDebugSnapshot } = await import("@/lib/cavtools/commandPlane.server");
            const snapshot = await readCavtoolsDebugSnapshot(req, {
              sessionId: query.sessionId,
              afterSeq,
              projectId: query.projectId,
              siteOrigin: query.siteOrigin,
            });

            if (!snapshot) {
              send("debug_end", { reason: "missing" });
              break;
            }

            const status = snapshot.status;
            const logs = snapshot.logs;
            const nextSeq = Number.isFinite(Number(logs.nextSeq)) ? Math.max(0, Math.trunc(Number(logs.nextSeq))) : afterSeq;
            let emitted = false;

            const statusSignature = [
              s(status.sessionId),
              s(status.status),
              s(status.updatedAtISO),
              String(nextSeq),
              String(status.currentLocation?.file || ""),
              String(status.currentLocation?.line || ""),
            ].join(":");
            if (statusSignature !== lastStatusSignature) {
              send("debug_status", status);
              lastStatusSignature = statusSignature;
              emitted = true;
            }

            if ((logs.entries || []).length || nextSeq > afterSeq) {
              send("debug_logs", logs);
              emitted = true;
            }

            if (!emitted) {
              send("debug_heartbeat", {
                sessionId: status.sessionId,
                status: status.status,
                nextSeq,
              });
            }
            afterSeq = Math.max(afterSeq, nextSeq);

            if (!isDebugActive(s(status.status))) {
              if (!(logs.entries || []).length) {
                send("debug_end", { reason: "completed", status: status.status });
                break;
              }
            }

            await sleep(STREAM_TICK_MS);
          }
        } catch (error) {
          send("debug_error", { message: toErrorMessage(error) });
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

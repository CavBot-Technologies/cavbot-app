import "server-only";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifyCavAiSessionShareToken } from "@/lib/cavai/sessionShareTokens.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function escapeHtml(raw: string) {
  const value = String(raw || "");
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function notFound() {
  noStore();
  return new NextResponse("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: {
    params: Promise<{ token?: string }>;
  }
) {
  try {
    const params = await ctx.params;
    const token = s(params.token);
    if (!token) return notFound();
    const payload = verifyCavAiSessionShareToken(token);
    if (!payload) return notFound();
    const tokenHash = sha256Hex(token);

    await prisma.cavAiShareArtifact.updateMany({
      where: {
        accountId: payload.accountId,
        externalTokenHash: tokenHash,
        revokedAt: null,
      },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
      },
    }).catch(() => undefined);

    const session = await prisma.cavAiSession.findFirst({
      where: {
        id: payload.sessionId,
        accountId: payload.accountId,
      },
      select: {
        id: true,
        title: true,
        surface: true,
        updatedAt: true,
      },
    });
    if (!session) return notFound();

    const messages = await prisma.cavAiMessage.findMany({
      where: {
        accountId: payload.accountId,
        sessionId: payload.sessionId,
      },
      orderBy: [{ createdAt: "asc" }],
      take: 300,
      select: {
        role: true,
        contentText: true,
        createdAt: true,
      },
    });
    if (!messages.length) return notFound();

    const title = escapeHtml(s(session.title) || "Shared CavAi conversation");
    const surface = escapeHtml(s(session.surface) || "workspace");
    const updatedAt = escapeHtml(
      (() => {
        try {
          return new Date(session.updatedAt).toLocaleString();
        } catch {
          return "";
        }
      })()
    );

    const rowsHtml = messages
      .map((row) => {
        const role = row.role === "assistant" ? "CavAi" : "You";
        const roleClass = row.role === "assistant" ? "assistant" : "user";
        const stamp = (() => {
          try {
            return new Date(row.createdAt).toLocaleString();
          } catch {
            return "";
          }
        })();
        return `
          <article class="msg ${roleClass}">
            <div class="head">
              <span class="role">${escapeHtml(role)}</span>
              <span class="time">${escapeHtml(stamp)}</span>
            </div>
            <pre class="body">${escapeHtml(s(row.contentText))}</pre>
          </article>
        `;
      })
      .join("");

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        background: #020617;
        color: rgba(240, 246, 255, 0.95);
      }
      .shell {
        max-width: 980px;
        margin: 0 auto;
        padding: 24px 16px 32px;
      }
      .title {
        margin: 0;
        font-size: 20px;
        line-height: 1.25;
        letter-spacing: -0.01em;
      }
      .meta {
        margin-top: 8px;
        color: rgba(190, 206, 238, 0.86);
        font-size: 12px;
      }
      .stream {
        margin-top: 18px;
        display: grid;
        gap: 10px;
      }
      .msg {
        border-radius: 12px;
        padding: 10px 11px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .msg.assistant {
        background: rgba(18, 24, 42, 0.88);
      }
      .msg.user {
        background: rgba(26, 36, 62, 0.88);
      }
      .head {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }
      .role {
        font-size: 11px;
        font-weight: 700;
        color: rgba(203, 218, 247, 0.92);
      }
      .time {
        font-size: 10px;
        color: rgba(176, 195, 229, 0.8);
      }
      .body {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "Courier New", monospace;
        white-space: pre-wrap;
        font-size: 12px;
        line-height: 1.55;
        color: rgba(236, 243, 255, 0.96);
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <h1 class="title">${title}</h1>
      <div class="meta">Shared CavAi thread · Surface: ${surface}${updatedAt ? ` · Updated: ${updatedAt}` : ""}</div>
      <section class="stream">${rowsHtml}</section>
    </main>
  </body>
</html>`;

    noStore();
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return notFound();
  }
}

import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { mintCavCloudObjectToken } from "@/lib/cavcloud/tokens.server";
import { buildCavcloudGatewayUrl } from "@/lib/cavcloud/gateway.server";
import { getSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function appOrigin(req: Request): string {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN || "").trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {}
  }
  return new URL(req.url).origin;
}

function normalizePath(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "/";
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  return withSlash.replace(/\/+/g, "/");
}

function normalizePathNoTrailingSlash(raw: string) {
  const n = normalizePath(raw);
  if (n.length > 1 && n.endsWith("/")) return n.slice(0, -1);
  return n;
}

function escapeHtml(raw: string) {
  const s = String(raw ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function requestAccessPanelHtml(args: {
  authRequiredHref: string;
  requestAccessHref: string;
  isAuthed: boolean;
  resourceType: "FILE" | "FOLDER" | null;
  resourceId: string | null;
}) {
  if (!args.resourceType || !args.resourceId) return "";
  if (!args.isAuthed) {
    return `<a class="request-link" href="${args.authRequiredHref}">Sign in to request edit access</a>`;
  }

  const resourceType = escapeHtml(args.resourceType);
  const resourceId = escapeHtml(args.resourceId);
  const endpoint = escapeHtml(args.requestAccessHref);
  return `
    <button id="cb-request-access-btn" class="request-btn" type="button">Request edit access</button>
    <div id="cb-request-access-msg" class="request-msg" role="status" aria-live="polite"></div>
    <script>
      (() => {
        const btn = document.getElementById("cb-request-access-btn");
        const msg = document.getElementById("cb-request-access-msg");
        if (!btn || !msg) return;
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          msg.textContent = "Sending request...";
          try {
            const res = await fetch("${endpoint}", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                resourceType: "${resourceType}",
                resourceId: "${resourceId}",
                requestedPermission: "EDIT",
              }),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.ok) {
              throw new Error(String(json?.message || "Failed to send request."));
            }
            msg.textContent = "Request sent.";
          } catch (err) {
            msg.textContent = err instanceof Error ? err.message : "Failed to send request.";
            btn.disabled = false;
          }
        });
      })();
    </script>
  `;
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

function artifactExpired(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

async function canAccessShare(req: Request, policyRaw: string | null | undefined, accountId: string | null | undefined) {
  const policy = String(policyRaw || "anyone").trim();
  if (policy === "anyone") return true;
  const session = await getSession(req);
  if (!session || session.systemRole !== "user" || !String(session.sub || "").trim()) return false;
  if (policy === "cavbotUsers") return true;
  if (policy === "workspaceMembers") {
    const shareAccountId = String(accountId || "").trim();
    if (!shareAccountId) return false;
    const member = await prisma.membership.findFirst({
      where: {
        accountId: shareAccountId,
        userId: String(session.sub || "").trim(),
      },
      select: { id: true },
    });
    return !!member;
  }
  return false;
}

export async function GET(req: Request, ctx: { params: { shareId?: string } }) {
  try {
    const shareId = String(ctx?.params?.shareId || "").trim();
    if (!shareId) return notFound();

    const share = await prisma.cavCloudShare.findUnique({
      where: { id: shareId },
      select: {
        id: true,
        accountId: true,
        mode: true,
        accessPolicy: true,
        expiresAt: true,
        revokedAt: true,
        artifact: {
          select: {
            id: true,
            userId: true,
            storageKey: true,
            visibility: true,
            publishedAt: true,
            expiresAt: true,
            sourcePath: true,
            displayTitle: true,
            type: true,
          },
        },
      },
    });

    if (!share) return notFound();
    if (share.revokedAt) return notFound();
    if (new Date(share.expiresAt).getTime() <= Date.now()) return notFound();
    if (share.mode !== "READ_ONLY") return notFound();
    if (!(await canAccessShare(req, share.accessPolicy, share.accountId))) return notFound();
    if (artifactExpired(share.artifact?.expiresAt)) return notFound();
    const url = new URL(req.url);
    const session = await getSession(req);
    const isAuthed = Boolean(session && session.systemRole === "user" && String(session.sub || "").trim());
    const authNextHref = `/auth?next=${encodeURIComponent(`/share/${shareId}`)}`;

    const objectKey = String(share.artifact?.storageKey || "").trim();
    if (objectKey) {
      const sourcePath = String(share.artifact?.sourcePath || "").trim();
      const shareAccountId = String(share.accountId || "").trim();
      const sharedFile = sourcePath && shareAccountId
        ? await prisma.cavCloudFile.findFirst({
            where: {
              accountId: shareAccountId,
              path: sourcePath,
              deletedAt: null,
            },
            select: {
              id: true,
              name: true,
            },
          })
        : null;

      const origin = appOrigin(req);
      const token = mintCavCloudObjectToken({
        origin,
        objectKey,
        ttlSeconds: 600,
      });

      const target = buildCavcloudGatewayUrl({ objectKey, token });
      if (url.searchParams.get("raw") === "1") {
        noStore();
        const res = NextResponse.redirect(target, 302);
        res.headers.set("Cache-Control", "no-store");
        // Ensure the CavCloud gateway sees an allowlisted Origin via Referer (origin-only on cross-site).
        res.headers.set("Referrer-Policy", "origin");
        res.headers.set("X-Robots-Tag", "noindex, nofollow");
        return res;
      }

      const title = escapeHtml(String(share.artifact?.displayTitle || sharedFile?.name || "Shared file"));
      const rawHref = `/share/${encodeURIComponent(shareId)}?raw=1`;
      const accessPanel = requestAccessPanelHtml({
        authRequiredHref: authNextHref,
        requestAccessHref: "/api/cavcloud/collab/requests",
        isAuthed,
        resourceType: sharedFile?.id ? "FILE" : null,
        resourceId: sharedFile?.id || null,
      });
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #111827; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      p { margin: 0 0 12px; color: #4b5563; font-size: 13px; }
      .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 0 0 16px; }
      .open-link { color: #0f172a; text-decoration: none; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
      .open-link:hover { text-decoration: underline; }
      .request-btn { border: 1px solid #111827; background: #111827; color: #fff; border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
      .request-btn:disabled { opacity: 0.7; cursor: default; }
      .request-link { color: #0f172a; text-decoration: none; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
      .request-link:hover { text-decoration: underline; }
      .request-msg { color: #6b7280; font-size: 12px; }
      .frame { width: 100%; min-height: 72vh; border: 1px solid #e5e7eb; border-radius: 10px; background: #f8fafc; }
      iframe { width: 100%; min-height: 72vh; border: 0; border-radius: 10px; background: #fff; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>Read-only, time-limited, revocable. File bytes are served through the CavCloud gateway.</p>
    <div class="actions">
      <a class="open-link" href="${rawHref}">Open raw file</a>
      ${accessPanel}
    </div>
    <div class="frame">
      <iframe src="${rawHref}" title="${title}"></iframe>
    </div>
  </body>
</html>`;

      noStore();
      return new NextResponse(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Robots-Tag": "noindex, nofollow",
          "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
      });
    }

    // Folder share: serve a read-only listing. Individual file clicks re-validate the share.
    const folderPathRaw = String(share.artifact?.sourcePath || "").trim();
    const ownerUserId = String(share.artifact?.userId || "").trim();
    if (!folderPathRaw || !ownerUserId) return notFound();

    const folderPath = normalizePathNoTrailingSlash(folderPathRaw);
    const prefix = folderPath === "/" ? "/" : `${folderPath}/`;
    const folderRef = share.accountId
      ? await prisma.cavCloudFolder.findFirst({
          where: {
            accountId: share.accountId,
            path: folderPath,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        })
      : null;

    const files = await prisma.publicArtifact.findMany({
      where: {
        userId: ownerUserId,
        sourcePath: { startsWith: prefix },
        storageKey: { not: "" },
        visibility: { in: ["LINK_ONLY", "PUBLIC_PROFILE"] },
        publishedAt: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { sourcePath: "asc" },
      select: {
        id: true,
        displayTitle: true,
        type: true,
      },
      take: 1000,
    });

    const title = String(share.artifact?.displayTitle || "Shared folder").trim() || "Shared folder";
    const accessPanel = requestAccessPanelHtml({
      authRequiredHref: authNextHref,
      requestAccessHref: "/api/cavcloud/collab/requests",
      isAuthed,
      resourceType: folderRef?.id ? "FOLDER" : null,
      resourceId: folderRef?.id || null,
    });
    const list = files
      .map((f) => {
        const href = `/share/${encodeURIComponent(shareId)}/artifact/${encodeURIComponent(f.id)}`;
        const t = escapeHtml(String(f.displayTitle || "Artifact"));
        const meta = escapeHtml(String(f.type || "FILE"));
        return `<li><a href="${href}">${t}</a><span class="meta">${meta}</span></li>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      :root { color-scheme: light; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #111827; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      p { margin: 0 0 16px; color: #6b7280; font-size: 13px; }
      ul { list-style: none; padding: 0; margin: 0; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
      li { display: flex; justify-content: space-between; gap: 12px; padding: 12px 14px; border-top: 1px solid #e5e7eb; }
      li:first-child { border-top: none; }
      a { color: #111827; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .meta { color: #6b7280; font-size: 12px; white-space: nowrap; }
      .empty { border: 1px dashed #e5e7eb; border-radius: 10px; padding: 14px; color: #6b7280; font-size: 13px; }
      .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 0 0 16px; }
      .request-btn { border: 1px solid #111827; background: #111827; color: #fff; border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
      .request-btn:disabled { opacity: 0.7; cursor: default; }
      .request-link { color: #0f172a; text-decoration: none; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
      .request-link:hover { text-decoration: underline; }
      .request-msg { color: #6b7280; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>Read-only, time-limited, revocable. Files are served via CavCloud gateway.</p>
    <div class="actions">${accessPanel}</div>
    ${files.length ? `<ul>${list}</ul>` : `<div class="empty">No files found for this share.</div>`}
  </body>
</html>`;

    noStore();
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  } catch {
    return notFound();
  }
}

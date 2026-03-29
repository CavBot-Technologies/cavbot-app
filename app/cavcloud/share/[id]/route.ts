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
    } catch {
      // fall through
    }
  }
  return new URL(req.url).origin;
}

function normalizePath(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function pathWithin(rootPath: string, candidatePath: string): boolean {
  const root = normalizePath(rootPath);
  const candidate = normalizePath(candidatePath);
  if (root === "/") return candidate.startsWith("/");
  return candidate === root || candidate.startsWith(`${root}/`);
}

function escapeHtml(raw: string): string {
  return String(raw || "")
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

function shareExpired(expiresAt: Date): boolean {
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

function folderBreadcrumbPaths(rootPath: string, currentPath: string): string[] {
  const root = normalizePath(rootPath);
  const current = normalizePath(currentPath);
  if (!pathWithin(root, current)) return [root];
  if (root === current) return [root];
  const suffix = current.slice(root.length).replace(/^\/+/, "");
  const parts = suffix.split("/").filter(Boolean);
  const out = [root];
  let cursor = root === "/" ? "" : root;
  for (const part of parts) {
    cursor = normalizePath(`${cursor}/${part}`);
    out.push(cursor);
  }
  return out;
}

function baseFolderName(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "CavCloud";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || "Folder";
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const shareId = String(ctx?.params?.id || "").trim();
    if (!shareId) return notFound();

    const share = await prisma.cavCloudStorageShare.findUnique({
      where: {
        id: shareId,
      },
      select: {
        id: true,
        accountId: true,
        mode: true,
        accessPolicy: true,
        expiresAt: true,
        revokedAt: true,
        fileId: true,
        folderId: true,
        file: {
          select: {
            id: true,
            name: true,
            path: true,
            r2Key: true,
            deletedAt: true,
          },
        },
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!share) return notFound();
    if (share.mode !== "READ_ONLY") return notFound();
    if (share.revokedAt) return notFound();
    if (shareExpired(share.expiresAt)) return notFound();
    if (!(await canAccessShare(req, share.accessPolicy, share.accountId))) return notFound();
    const url = new URL(req.url);
    const session = await getSession(req);
    const isAuthed = Boolean(session && session.systemRole === "user" && String(session.sub || "").trim());
    const authNextHref = `/auth?next=${encodeURIComponent(`/cavcloud/share/${shareId}`)}`;

    // Direct file share.
    if (share.fileId) {
      const file = share.file;
      if (!file || file.deletedAt || !String(file.r2Key || "").trim()) return notFound();

      const token = mintCavCloudObjectToken({
        origin: appOrigin(req),
        objectKey: file.r2Key,
        ttlSeconds: 600,
      });

      const gatewayUrl = buildCavcloudGatewayUrl({ objectKey: file.r2Key, token });
      if (url.searchParams.get("raw") === "1") {
        noStore();
        const res = NextResponse.redirect(gatewayUrl, 302);
        res.headers.set("Cache-Control", "no-store");
        res.headers.set("Referrer-Policy", "origin");
        res.headers.set("X-Robots-Tag", "noindex, nofollow");
        return res;
      }

      const title = escapeHtml(file.name || "Shared file");
      const accessPanel = requestAccessPanelHtml({
        authRequiredHref: authNextHref,
        requestAccessHref: "/api/cavcloud/collab/requests",
        isAuthed,
        resourceType: "FILE",
        resourceId: file.id,
      });
      const rawHref = `/cavcloud/share/${encodeURIComponent(shareId)}?raw=1`;
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · CavCloud Share</title>
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

    // Folder share.
    if (!share.folderId || !share.folder || share.folder.deletedAt) return notFound();
    const rootFolder = share.folder;
    const requestedFolderId = String(url.searchParams.get("folderId") || rootFolder.id).trim() || rootFolder.id;
    const requestedFileId = String(url.searchParams.get("fileId") || "").trim();

    const currentFolder = await prisma.cavCloudFolder.findFirst({
      where: {
        id: requestedFolderId,
        accountId: share.accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
      },
    });
    if (!currentFolder || !pathWithin(rootFolder.path, currentFolder.path)) return notFound();

    if (requestedFileId) {
      const file = await prisma.cavCloudFile.findFirst({
        where: {
          id: requestedFileId,
          accountId: share.accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
          r2Key: true,
        },
      });
      if (!file || !pathWithin(rootFolder.path, file.path) || !String(file.r2Key || "").trim()) return notFound();

      const token = mintCavCloudObjectToken({
        origin: appOrigin(req),
        objectKey: file.r2Key,
        ttlSeconds: 600,
      });

      noStore();
      const res = NextResponse.redirect(buildCavcloudGatewayUrl({ objectKey: file.r2Key, token }), 302);
      res.headers.set("Cache-Control", "no-store");
      res.headers.set("Referrer-Policy", "origin");
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
      return res;
    }

    const [folders, files] = await Promise.all([
      prisma.cavCloudFolder.findMany({
        where: {
          accountId: share.accountId,
          parentId: currentFolder.id,
          deletedAt: null,
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.cavCloudFile.findMany({
        where: {
          accountId: share.accountId,
          folderId: currentFolder.id,
          deletedAt: null,
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          bytes: true,
        },
      }),
    ]);

    const breadcrumbRows = await prisma.cavCloudFolder.findMany({
      where: {
        accountId: share.accountId,
        path: { in: folderBreadcrumbPaths(rootFolder.path, currentFolder.path) },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
      },
    });
    const breadcrumbMap = new Map(breadcrumbRows.map((row) => [row.path, row]));
    const breadcrumbHtml = folderBreadcrumbPaths(rootFolder.path, currentFolder.path)
      .map((path, idx, all) => {
        const row = breadcrumbMap.get(path);
        if (!row) return "";
        const href = `/cavcloud/share/${encodeURIComponent(shareId)}?folderId=${encodeURIComponent(row.id)}`;
        const label = escapeHtml(row.path === rootFolder.path ? baseFolderName(rootFolder.path) : row.name);
        const node = idx === all.length - 1
          ? `<span class="crumb current">${label}</span>`
          : `<a class="crumb" href="${href}">${label}</a>`;
        return node;
      })
      .filter(Boolean)
      .join(`<span class="sep">/</span>`);

    const folderItems = folders
      .map((folder) => {
        const href = `/cavcloud/share/${encodeURIComponent(shareId)}?folderId=${encodeURIComponent(folder.id)}`;
        return `<li><a href="${href}" class="folder">${escapeHtml(folder.name)}</a><span class="meta">Folder</span></li>`;
      })
      .join("");

    const fileItems = files
      .map((file) => {
        const href = `/cavcloud/share/${encodeURIComponent(shareId)}?folderId=${encodeURIComponent(currentFolder.id)}&fileId=${encodeURIComponent(file.id)}`;
        const bytes = Number(file.bytes || 0);
        return `<li><a href="${href}" class="file">${escapeHtml(file.name)}</a><span class="meta">${bytes} bytes</span></li>`;
      })
      .join("");

    const title = escapeHtml(baseFolderName(rootFolder.path));
    const content = folderItems + fileItems;
    const accessPanel = requestAccessPanelHtml({
      authRequiredHref: authNextHref,
      requestAccessHref: "/api/cavcloud/collab/requests",
      isAuthed,
      resourceType: "FOLDER",
      resourceId: rootFolder.id,
    });

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · CavCloud Share</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #111827; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      p { margin: 0 0 12px; color: #4b5563; font-size: 13px; }
      .crumbs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 16px; font-size: 13px; }
      .crumb { color: #0f172a; text-decoration: none; }
      .crumb:hover { text-decoration: underline; }
      .crumb.current { color: #6b7280; }
      .sep { color: #9ca3af; }
      ul { list-style: none; padding: 0; margin: 0; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
      li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-top: 1px solid #e5e7eb; }
      li:first-child { border-top: none; }
      a { color: #111827; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .folder::before { content: "[DIR] "; color: #6b7280; }
      .file::before { content: "[FILE] "; color: #6b7280; }
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
    <h1>${title}</h1>
    <p>Read-only, time-limited, revocable. Downloads are tokenized through CavCloud gateway.</p>
    <div class="actions">${accessPanel}</div>
    <div class="crumbs">${breadcrumbHtml}</div>
    ${content ? `<ul>${content}</ul>` : `<div class="empty">This folder is empty.</div>`}
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

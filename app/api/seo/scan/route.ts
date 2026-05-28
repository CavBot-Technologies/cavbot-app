import { NextResponse } from "next/server";

import { isApiAuthError } from "@/lib/apiAuth";
import { gateModuleAccess } from "@/lib/moduleGate.server";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  createSeoScanAndRun,
  normalizeSeoScanOrigin,
  SeoScanError,
} from "@/lib/seo/seoScan.server";
import { requireWorkspaceSession } from "@/lib/workspaceAuth.server";
import { expandRelatedExactOrigins } from "@/originMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(data: unknown, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: {
      ...NO_STORE_HEADERS,
      ...(resInit.headers || {}),
    },
  });
}

function parseProjectId(value: unknown) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanBodyString(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function errorJson(error: string, message: string, status: number, extra?: Record<string, unknown>) {
  return json(
    {
      ok: false,
      error,
      message,
      ...(extra || {}),
    },
    status,
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(req: Request) {
  try {
    const session = await requireWorkspaceSession(req);
    const gate = await gateModuleAccess(req, "seo");
    if (!gate.ok) {
      return errorJson("FORBIDDEN", "SEO Audit requires access to the SEO module.", 403, {
        planId: gate.planId,
      });
    }

    const body = (await readSanitizedJson(req, null)) as
      | null
      | {
          projectId?: unknown;
          siteId?: unknown;
          origin?: unknown;
          mode?: unknown;
        };

    const projectId = parseProjectId(body?.projectId);
    const siteId = cleanBodyString(body?.siteId, 140);
    const mode = cleanBodyString(body?.mode, 40) || "single-page";
    let origin: string | null = null;

    try {
      origin = normalizeSeoScanOrigin(cleanBodyString(body?.origin, 600));
    } catch (error) {
      const message = error instanceof SeoScanError ? error.safeMessage : "Enter a valid HTTP or HTTPS origin.";
      return errorJson("INVALID_ORIGIN", message, 400);
    }

    if (!projectId) return errorJson("INVALID_PROJECT", "A valid projectId is required.", 400);
    if (!siteId) return errorJson("INVALID_SITE", "A valid siteId is required.", 400);
    if (!origin) return errorJson("INVALID_ORIGIN", "Enter a valid HTTP or HTTPS origin.", 400);
    if (mode !== "single-page") return errorJson("INVALID_MODE", "Only single-page SEO scans are supported right now.", 400);

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        accountId: session.accountId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });
    if (!project) return errorJson("FORBIDDEN", "That project is not available in this workspace.", 403);

    const site = await prisma.site.findFirst({
      where: {
        id: siteId,
        projectId: project.id,
        isActive: true,
      },
      select: {
        id: true,
        origin: true,
        status: true,
      },
    });
    if (!site) return errorJson("FORBIDDEN", "That site is not available in this project.", 403);
    if (site.status !== "VERIFIED") {
      return errorJson("UNVERIFIED_SITE", "SEO scans require an approved and verified site.", 409);
    }

    const allowedOrigins = expandRelatedExactOrigins(site.origin);
    if (!allowedOrigins.includes(origin)) {
      return errorJson("ORIGIN_MISMATCH", "The requested origin does not match the verified site.", 400);
    }

    const scan = await createSeoScanAndRun({
      accountId: session.accountId,
      operatorUserId: session.sub,
      projectId: project.id,
      siteId: site.id,
      origin: site.origin,
      source: "api",
      request: req,
    });

    if (scan.status === "FAILED") {
      return errorJson("SCAN_FAILED", "The SEO scan was stored but did not complete successfully.", 502, {
        scanId: scan.id,
        status: scan.status,
      });
    }

    return json(
      {
        ok: true,
        scanId: scan.id,
        status: scan.status,
      },
      201,
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      return errorJson(error.status === 401 ? "UNAUTHENTICATED" : error.code, error.code, error.status);
    }
    if (error instanceof SeoScanError) {
      return errorJson(error.code, error.safeMessage, error.status, {
        retryAfter: error.retryAfterSec || undefined,
      });
    }
    return errorJson("SCAN_FAILED", "CavBot could not create the SEO scan.", 500);
  }
}

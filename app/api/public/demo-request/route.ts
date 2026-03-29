import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendEmail } from "@/lib/email/sendEmail";
import {
  buildVerifyErrorPayload,
  ensureActionVerification,
  extractVerifyGrantToken,
  extractVerifySessionId,
  recordVerifyActionFailure,
  recordVerifyActionSuccess,
} from "@/lib/auth/cavbotVerify";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Origin",
};

function allowedOrigins(): Set<string> {
  const out = new Set<string>([
    "https://cavbot.io",
    "https://www.cavbot.io",
  ]);
  const configured = [
    process.env.CAVBOT_APP_ORIGIN,
    process.env.NEXT_PUBLIC_APP_ORIGIN,
    process.env.NEXT_PUBLIC_APP_URL,
  ];
  for (const row of configured) {
    const normalized = normalizeOrigin(s(row));
    if (normalized) out.add(normalized);
  }
  if (process.env.NODE_ENV !== "production") {
    out.add("http://localhost:3000");
    out.add("http://127.0.0.1:3000");
    out.add("http://localhost:5500");
    out.add("http://127.0.0.1:5500");
  }
  return out;
}

const DEMO_REQUEST_SCHEMA = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  businessEmail: z.string().trim().email().max(160),
  jobTitle: z.string().trim().max(120).optional(),
  company: z.string().trim().min(1).max(160),
  phoneNumber: z.string().trim().min(1).max(60),
  website: z.string().trim().max(200).optional(),
  sourcePath: z.string().trim().max(1200).optional(),
  sourceOrigin: z.string().trim().max(200).optional(),
  sourceHref: z.string().trim().max(2400).optional(),
  userAgent: z.string().trim().max(600).optional(),
  verificationGrantToken: z.string().trim().max(600).optional(),
  verificationSessionId: z.string().trim().max(120).optional(),
  verifySessionId: z.string().trim().max(120).optional(),
});

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function h(value: unknown): string {
  return s(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function requestIdFrom(req: NextRequest): string {
  return s(req.headers.get("x-request-id")) || crypto.randomUUID();
}

function normalizeOrigin(value: string): string {
  const raw = s(value);
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

function resolveCorsOrigin(req: NextRequest): string {
  const origin = normalizeOrigin(s(req.headers.get("origin")));
  if (!origin) return "";
  return allowedOrigins().has(origin) ? origin : "";
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const allowOrigin = resolveCorsOrigin(req);
  if (!allowOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, x-cavbot-csrf, x-request-id, x-cavbot-verify-grant, x-cavbot-verify-session",
    "Access-Control-Max-Age": "86400",
  };
}

function buildHeaders(req: NextRequest, extra?: HeadersInit): HeadersInit {
  return {
    ...NO_STORE_HEADERS,
    ...corsHeaders(req),
    ...(extra || {}),
  };
}

function json(req: NextRequest, payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: buildHeaders(req, base.headers),
  });
}

function clientIp(req: NextRequest): string {
  const forwarded = s(req.headers.get("x-forwarded-for"));
  if (forwarded) {
    const first = s(forwarded.split(",")[0]);
    if (first) return first;
  }
  return s(req.headers.get("x-real-ip")) || "ip:unknown";
}

function demoRequestRecipient(): string {
  return (
    s(process.env.CAVBOT_DEMO_REQUEST_TO) ||
    s(process.env.SALES_EMAIL_TO) ||
    s(process.env.MAIL_TO) ||
    "support@cavbot.io"
  );
}

function buildDemoRequestEmail(parsed: z.infer<typeof DEMO_REQUEST_SCHEMA>, requestId: string): string {
  const jobTitle = s(parsed.jobTitle) || "Not provided";
  const sourcePath = s(parsed.sourcePath) || "Unknown";
  const sourceOrigin = s(parsed.sourceOrigin) || "Unknown";
  const sourceHref = s(parsed.sourceHref) || "Unknown";
  const userAgent = s(parsed.userAgent) || "Unknown";
  const createdAt = new Date().toISOString();

  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.55;color:#0b1220;">
    <h2 style="margin:0 0 12px;">New CavBot Demo Request</h2>
    <p style="margin:0 0 14px;color:#475467;">A website visitor submitted the Request a Demo form.</p>
    <table style="border-collapse:collapse;width:100%;max-width:760px;">
      <tbody>
        <tr><td style="padding:6px 0;font-weight:600;">First Name</td><td style="padding:6px 0;">${h(parsed.firstName)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;">Last Name</td><td style="padding:6px 0;">${h(parsed.lastName)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;">Business Email</td><td style="padding:6px 0;"><a href="mailto:${h(parsed.businessEmail)}">${h(parsed.businessEmail)}</a></td></tr>
        <tr><td style="padding:6px 0;font-weight:600;">Job Title</td><td style="padding:6px 0;">${h(jobTitle)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;">Company</td><td style="padding:6px 0;">${h(parsed.company)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;">Phone Number</td><td style="padding:6px 0;">${h(parsed.phoneNumber)}</td></tr>
      </tbody>
    </table>
    <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="margin:0 0 6px;font-size:13px;color:#475467;"><strong>Source Origin:</strong> ${h(sourceOrigin)}</p>
    <p style="margin:0 0 6px;font-size:13px;color:#475467;"><strong>Source Path:</strong> ${h(sourcePath)}</p>
    <p style="margin:0 0 6px;font-size:13px;color:#475467;"><strong>Source URL:</strong> ${h(sourceHref)}</p>
    <p style="margin:0 0 6px;font-size:13px;color:#475467;"><strong>User Agent:</strong> ${h(userAgent)}</p>
    <p style="margin:0 0 6px;font-size:13px;color:#475467;"><strong>Request ID:</strong> ${h(requestId)}</p>
    <p style="margin:0;font-size:13px;color:#475467;"><strong>Received At:</strong> ${h(createdAt)}</p>
  </div>
  `;
}

export async function OPTIONS(req: NextRequest) {
  const requestOrigin = s(req.headers.get("origin"));
  if (requestOrigin && !resolveCorsOrigin(req)) {
    return json(
      req,
      {
        ok: false,
        error: "ORIGIN_DENIED",
        message: "Origin is not allowed for demo requests.",
      },
      403
    );
  }

  return new NextResponse(null, {
    status: 204,
    headers: buildHeaders(req, { Allow: "POST, OPTIONS" }),
  });
}

export async function POST(req: NextRequest) {
  const requestId = requestIdFrom(req);
  const requestOrigin = s(req.headers.get("origin"));
  const allowOrigin = resolveCorsOrigin(req);

  if (requestOrigin && !allowOrigin) {
    return json(
      req,
      {
        ok: false,
        requestId,
        error: "ORIGIN_DENIED",
        message: "Origin is not allowed for demo requests.",
      },
      403
    );
  }

  if (!hasRequestIntegrityHeader(req)) {
    return json(
      req,
      {
        ok: false,
        requestId,
        error: "BAD_CSRF",
        message: "Missing request integrity header.",
      },
      403
    );
  }

  const ip = clientIp(req);
  const ipRate = consumeInMemoryRateLimit({
    key: `demo-request:ip:${ip}`,
    limit: 8,
    windowMs: 60_000,
  });
  if (!ipRate.allowed) {
    return json(
      req,
      {
        ok: false,
        requestId,
        error: "RATE_LIMITED",
        message: `Too many requests. Retry in ${ipRate.retryAfterSec}s.`,
      },
      429
    );
  }

  const bodyRaw = await readSanitizedJson(req, null);
  const parsed = DEMO_REQUEST_SCHEMA.safeParse(bodyRaw);
  if (!parsed.success) {
    return json(
      req,
      {
        ok: false,
        requestId,
        error: "INVALID_INPUT",
        message: "Invalid demo request payload.",
      },
      400
    );
  }

  if (s(parsed.data.website)) {
    return json(req, {
      ok: true,
      requestId,
      message: "Thanks. Your demo request has been received.",
    });
  }

  const verificationGate = ensureActionVerification(req, {
    actionType: "invite",
    route: "/request-demo",
    sessionIdHint: extractVerifySessionId(req, parsed.data.verificationSessionId || parsed.data.verifySessionId),
    verificationGrantToken: extractVerifyGrantToken(req, parsed.data.verificationGrantToken),
  });

  if (!verificationGate.ok) {
    recordVerifyActionFailure(req, { actionType: "invite", sessionIdHint: verificationGate.sessionId });
    const payload = buildVerifyErrorPayload(verificationGate);
    return json(
      req,
      {
        ...payload,
        requestId,
      },
      verificationGate.decision === "block" ? 429 : 403
    );
  }

  const emailRate = consumeInMemoryRateLimit({
    key: `demo-request:email:${parsed.data.businessEmail.toLowerCase()}`,
    limit: 3,
    windowMs: 600_000,
  });
  if (!emailRate.allowed) {
    return json(
      req,
      {
        ok: false,
        requestId,
        error: "RATE_LIMITED",
        message: `Too many requests for this email. Retry in ${emailRate.retryAfterSec}s.`,
      },
      429
    );
  }

  const recipient = demoRequestRecipient();
  const subject = `CavBot demo request — ${s(parsed.data.firstName)} ${s(parsed.data.lastName)} (${s(parsed.data.company)})`;
  const html = buildDemoRequestEmail(parsed.data, requestId);

  try {
    await sendEmail({
      to: recipient,
      subject,
      html,
    });
  } catch (error) {
    console.error("POST /api/public/demo-request email failed", {
      requestId,
      error,
    });
    return json(
      req,
      {
        ok: false,
        requestId,
        error: "DELIVERY_FAILED",
        message: "Unable to send demo request right now. Please try again shortly.",
      },
      502
    );
  }

  recordVerifyActionSuccess(req, { actionType: "invite", sessionIdHint: verificationGate.sessionId });

  return json(req, {
    ok: true,
    requestId,
    message: "Thanks. Your demo request has been received.",
  });
}

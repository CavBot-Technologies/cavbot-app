// app/api/notifications/storage-low/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { sendEmail } from "@/lib/email/sendEmail";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function fmtBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(val >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

async function shouldNotify(userId: string, accountId: string) {
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const recent = await prisma.notification.findFirst({
    where: {
      userId,
      accountId,
      title: "Storage low",
      createdAt: { gt: since },
    },
    select: { id: true },
  });
  return !recent;
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const userId = s(sess.sub);
    const accountId = s(sess.accountId);
    if (!userId || !accountId) return json({ ok: false }, 401);

    const body = (await readSanitizedJson(req, null)) as { usedBytes?: unknown; limitBytes?: unknown; pct?: unknown } | null;
    const usedBytes = Number(body?.usedBytes || 0);
    const limitBytes = Number(body?.limitBytes || 0);
    const pct = Number(body?.pct || 0);

    const owners = await prisma.membership.findMany({
      where: { accountId, role: "OWNER" },
      select: { userId: true, user: { select: { email: true } } },
    });

    await Promise.all(
      owners.map(async (m) => {
        const settings = await prisma.notificationSettings.findFirst({
          where: { userId: m.userId, accountId },
        });

        const allowEmail = settings?.billingEmails ?? true;
        const allowInApp = settings?.inAppSignals ?? true;

        if (allowInApp && (await shouldNotify(m.userId, accountId))) {
          await prisma.notification.create({
            data: {
              userId: m.userId,
              accountId,
              title: "Storage low",
              body: `CavCloud is at ${pct}% of its storage limit.`,
              tone: "WATCH",
            },
          });
        }

        if (allowEmail && m.user?.email) {
          await sendEmail({
            to: m.user.email,
            subject: "CavCloud storage is running low",
            html: `
              <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
                <h2 style="margin:0 0 10px;">Storage warning</h2>
                <p style="margin:0 0 12px;">
                  CavCloud storage is running low for your workspace.
                </p>
                <div style="margin:16px 0; padding:12px 14px; border-radius:12px; background:#0b1020; border:1px solid rgba(255,255,255,0.14);">
                  <div style="font-size:12px; color:rgba(234,240,255,0.7);">Usage</div>
                  <div style="font-size:20px; font-weight:800; color:#eaf0ff;">
                    ${fmtBytes(usedBytes)} / ${fmtBytes(limitBytes)} (${pct}%)
                  </div>
                </div>
                <p style="margin:12px 0 0; font-size:12px; color:rgba(234,240,255,0.7);">
                  Clear space or upgrade to avoid interruptions.
                </p>
              </div>
            `,
          });
        }
      })
    );

    return json({ ok: true }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "STORAGE_LOW_FAILED" }, 500);
  }
}

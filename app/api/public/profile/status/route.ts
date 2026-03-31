// app/api/public/profile/status/route.ts
import { NextResponse } from "next/server";
import { unstable_noStore as noStore, revalidateTag } from "next/cache";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireSession, requireUser, isApiAuthError } from "@/lib/apiAuth";
import { isBasicUsername, isReservedUsername, normalizeUsername, RESERVED_ROUTE_SLUGS } from "@/lib/username";
import { containsEmoji, isPublicStatusMode, normalizePublicStatusNote } from "@/lib/publicProfile/publicStatus";
import { withAuditLogUserIdField } from "@/lib/auditModelCompat";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");

function jsonNoStore<T>(body: T, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function isUnsafeSlug(raw: string) {
  const v = String(raw || "").trim();
  if (!v) return true;
  if (v.includes(".") || v.includes("/") || v.includes("\\")) return true;
  return false;
}

function safeISO(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export async function GET(req: Request) {
  noStore();
  try {
    const { searchParams } = new URL(req.url);
    const raw = String(searchParams.get("username") || "").trim();
    if (isUnsafeSlug(raw)) {
      return jsonNoStore({ ok: true, enabled: false, mode: null, note: null, updatedAtISO: null }, { status: 200 });
    }

    const username = normalizeUsername(raw);
    if (!username) return jsonNoStore({ ok: true, enabled: false, mode: null, note: null, updatedAtISO: null }, { status: 200 });
    if (!isBasicUsername(username)) return jsonNoStore({ ok: true, enabled: false, mode: null, note: null, updatedAtISO: null }, { status: 200 });
    if ((RESERVED_ROUTE_SLUGS as readonly string[]).includes(username)) return jsonNoStore({ ok: true, enabled: false, mode: null, note: null, updatedAtISO: null }, { status: 200 });
    if (isReservedUsername(username) && (!OWNER_USERNAME || username !== OWNER_USERNAME)) {
      return jsonNoStore({ ok: true, enabled: false, mode: null, note: null, updatedAtISO: null }, { status: 200 });
    }

    try {
      const user = await (async () => {
        try {
          return await prisma.user.findUnique({
            where: { username },
            select: {
              id: true,
              publicProfileEnabled: true,
              showStatusOnPublicProfile: true,
              userStatus: true,
              userStatusNote: true,
              userStatusUpdatedAt: true,
              // Back-compat: older columns (keep reading during rollout).
              publicStatusEnabled: true,
              publicStatusMode: true,
              publicStatusNote: true,
              publicStatusUpdatedAt: true,
            },
          });
        } catch {
          // Bootstrap safety: if columns aren't present yet, read from legacy columns.
          return await prisma.user.findUnique({
            where: { username },
            select: {
              id: true,
              publicProfileEnabled: true,
              publicStatusEnabled: true,
              publicStatusMode: true,
              publicStatusNote: true,
              publicStatusUpdatedAt: true,
            },
          });
        }
      })();

      if (!user?.id || !user.publicProfileEnabled) {
        return jsonNoStore(
          { ok: true, showStatusOnPublicProfile: false, userStatus: null, note: null, updatedAtISO: null, enabled: false, mode: null },
          { status: 200 }
        );
      }

      const showStatusOnPublicProfile =
        "showStatusOnPublicProfile" in user
          ? Boolean((user as { showStatusOnPublicProfile?: unknown }).showStatusOnPublicProfile)
          : Boolean((user as { publicStatusEnabled?: unknown }).publicStatusEnabled);

      const statusRaw =
        "userStatus" in user
          ? String((user as { userStatus?: unknown }).userStatus ?? "").trim()
          : String((user as { publicStatusMode?: unknown }).publicStatusMode ?? "").trim();

      const userStatus = isPublicStatusMode(statusRaw) ? statusRaw : null;

      const noteRaw =
        "userStatusNote" in user
          ? String((user as { userStatusNote?: unknown }).userStatusNote ?? "").trim()
          : String((user as { publicStatusNote?: unknown }).publicStatusNote ?? "").trim();
      const note = noteRaw ? noteRaw.slice(0, 64) : null;

      const updatedAtISO =
        safeISO(
          "userStatusUpdatedAt" in user
            ? (user as { userStatusUpdatedAt?: unknown }).userStatusUpdatedAt
            : (user as { publicStatusUpdatedAt?: unknown }).publicStatusUpdatedAt
        ) || null;

      // Back-compat: enabled/mode only reflect "visible AND set".
      const enabled = Boolean(showStatusOnPublicProfile) && Boolean(userStatus);
      const mode = userStatus;

      return jsonNoStore(
        { ok: true, showStatusOnPublicProfile, userStatus, note, updatedAtISO, enabled, mode },
        { status: 200 }
      );
    } catch {
      // Dev/bootstrap safety: if columns aren't present yet, fail-closed.
      return jsonNoStore(
        { ok: true, showStatusOnPublicProfile: false, userStatus: null, note: null, updatedAtISO: null, enabled: false, mode: null },
        { status: 200 }
      );
    }
  } catch (e) {
    console.error("GET /api/public/profile/status failed:", e);
    return jsonNoStore(
      { ok: true, showStatusOnPublicProfile: false, userStatus: null, note: null, updatedAtISO: null, enabled: false, mode: null },
      { status: 200 }
    );
  }
}

export async function PUT(req: Request) {
  noStore();
  try {
    const sess = await requireSession(req);
    requireUser(sess);

    const body = (await readSanitizedJson(req, null)) as
      | {
          // New API (preferred)
          showStatusOnPublicProfile?: unknown;
          userStatus?: unknown;
          // Back-compat
          enabled?: unknown;
          mode?: unknown;
          note?: unknown;
        }
      | null;

    const showStatusOnPublicProfile =
      typeof body?.showStatusOnPublicProfile === "boolean" ? Boolean(body.showStatusOnPublicProfile) : Boolean(body?.enabled);
    const statusRaw = body?.userStatus ?? body?.mode;
    const noteRaw = body?.note;

    const status = typeof statusRaw === "string" ? statusRaw.trim() : statusRaw == null ? "" : String(statusRaw).trim();
    const noteNorm = normalizePublicStatusNote(noteRaw);

    if (noteNorm && noteNorm.length > 64) {
      return jsonNoStore({ ok: false, message: "Note must be 64 characters or less." }, { status: 400 });
    }
    if (noteNorm && containsEmoji(noteNorm)) {
      return jsonNoStore({ ok: false, message: "Emojis are not allowed in status." }, { status: 400 });
    }

    // Allow "Not set" (null) even when visible.
    if (status && !isPublicStatusMode(status)) {
      return jsonNoStore({ ok: false, message: "Select a valid status." }, { status: 400 });
    }

    const userId = String(sess.sub || "").trim();
    if (!userId) return jsonNoStore({ ok: false, message: "Unauthorized." }, { status: 401 });

    const userStatusForUpdate = status ? status : null;

    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          showStatusOnPublicProfile,
          // Keep last status/note even when hidden (visibility toggle is the gate).
          userStatus: userStatusForUpdate,
          userStatusNote: noteNorm,
          userStatusUpdatedAt: new Date(),
        },
      });
    } catch {
      // Bootstrap safety: if new columns aren't present, fall back to legacy columns.
      const modeForUpdate = userStatusForUpdate && isPublicStatusMode(userStatusForUpdate) ? userStatusForUpdate : undefined;
      await prisma.user.update({
        where: { id: userId },
        data: {
          publicStatusEnabled: showStatusOnPublicProfile,
          publicStatusMode: modeForUpdate,
          publicStatusNote: noteNorm,
          publicStatusUpdatedAt: new Date(),
        },
      });
    }

    // Record in Settings -> History.
    // Keep audit logging best-effort: never block saving presence status.
    try {
      const ip =
        req.headers.get("cf-connecting-ip") ||
        req.headers.get("true-client-ip") ||
        (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
        req.headers.get("x-real-ip") ||
        null;
      const userAgent = req.headers.get("user-agent") || null;
      const accountId = typeof sess.accountId === "string" && sess.accountId.trim() ? sess.accountId.trim() : null;
      if (accountId) {
        const data = withAuditLogUserIdField(
          {
            accountId,
            action: "PROFILE_UPDATED",
            actionLabel: "Status updated",
            category: "changes",
            severity: "info",
            targetType: "presence_status",
            targetId: userId,
            targetLabel: "Presence status",
            metaJson: {
              showStatusOnPublicProfile,
              userStatus: userStatusForUpdate,
              note: noteNorm || null,
            },
            ip: ip && String(ip).trim() ? String(ip).trim() : null,
            userAgent: userAgent && String(userAgent).trim() ? String(userAgent).trim() : null,
          },
          userId
        );

        await prisma.auditLog.create({
          data: data as Prisma.AuditLogUncheckedCreateInput,
        });
      }
    } catch {}

    try { revalidateTag("cb-public-profile-v1"); } catch {}

    return jsonNoStore({ ok: true }, { status: 200 });
  } catch (e) {
    if (isApiAuthError(e)) {
      return jsonNoStore({ ok: false, message: e.code }, { status: e.status });
    }
    console.error("PUT /api/public/profile/status failed:", e);
    return jsonNoStore({ ok: false, message: "Save failed." }, { status: 500 });
  }
}

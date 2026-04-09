// app/api/settings/security/username/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { findUserById, getAuthPool } from "@/lib/authDb";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import {
  applyUsernameChange,
  isSecuritySettingsStoreError,
  usernameInUse,
  usernameTombstoneExists,
} from "@/lib/settings/securityRuntime.server";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";
import { readCoarseRequestGeo } from "@/lib/requestGeo";
import {
  normalizeUsername,
  isReservedUsername,
  isBasicUsername,
  USERNAME_MIN,
  USERNAME_MAX,
} from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type UsernameResponseBody = Record<string, unknown>;
function json(data: UsernameResponseBody, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

const COOLDOWN_DAYS = 30;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const FREE_CHANGES = 3;

export async function PATCH(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);

    const accountId = sess.accountId;
    const userId = sess.sub;

    const body = (await readSanitizedJson(req, null)) as null | { newUsername?: string };
    const candidate = normalizeUsername(body?.newUsername || "");

    if (!candidate) {
      return json({ error: "BAD_INPUT", message: "Enter a username." }, 400);
    }

    if (candidate.length < USERNAME_MIN || candidate.length > USERNAME_MAX) {
      return json({ error: "BAD_INPUT", message: `Usernames must be ${USERNAME_MIN}-${USERNAME_MAX} characters.` }, 400);
    }

    if (!isBasicUsername(candidate)) {
      return json({ error: "BAD_INPUT", message: "Use only letters, numbers, and underscores, starting with a letter." }, 400);
    }

    if (isReservedUsername(candidate)) {
      return json({ error: "USERNAME_RESERVED", message: "Choose a different username." }, 400);
    }

    const geo = readCoarseRequestGeo(req);

    const user = await findUserById(getAuthPool(), userId);

    if (!user) {
      return json({ error: "AUTH_NOT_FOUND", message: "User record not found." }, 404);
    }

    const current = normalizeUsername(user.username || "");
    if (current === candidate) {
      return json({ error: "NO_CHANGE", message: "That is already your username." }, 400);
    }

    const taken = await usernameInUse(candidate);
    if (taken) {
      return json({ error: "USERNAME_TAKEN", message: "Username already in use." }, 409);
    }

    const tombstoned = await usernameTombstoneExists(candidate);
    if (tombstoned) {
      return json({ error: "USERNAME_TAKEN", message: "Username is unavailable." }, 409);
    }

    const changeCount = Number(user.usernameChangeCount || 0);
    const lastChangeAt = user.lastUsernameChangeAt ? new Date(user.lastUsernameChangeAt) : null;
    const now = new Date();

    if (changeCount >= FREE_CHANGES) {
      if (!lastChangeAt) {
        return json(
          {
            error: "COOLDOWN",
            message: "Username changes are limited to once every 30 days after the third change.",
          },
          429
        );
      }

      const nextAllowed = new Date(lastChangeAt.getTime() + COOLDOWN_MS);
      if (now < nextAllowed) {
        const daysRemaining = Math.ceil((nextAllowed.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        return json(
          {
            error: "COOLDOWN",
            message: `Next username change will be available in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`,
            retryAfterDays: daysRemaining,
          },
          429
        );
      }
    }

    const result = await applyUsernameChange({
      userId,
      accountId,
      currentUsername: current,
      nextUsername: candidate,
      changedAt: now,
    });

    await auditLogWrite({
      request: req,
      action: "USERNAME_CHANGED",
      accountId,
      operatorUserId: userId,
      targetType: "user",
      targetId: userId,
      targetLabel: candidate,
      metaJson: {
        oldUsername: current || null,
        newUsername: candidate,
        location: geo.label,
        geoCountry: geo.country,
        geoRegion: geo.region,
        at: now.toISOString(),
      },
    });

    const changeCountAfter = Number(result.usernameChangeCount || 0);
    const changesRemaining = Math.max(0, FREE_CHANGES - changeCountAfter);
    const nextAvailable = changeCountAfter >= FREE_CHANGES ? new Date(now.getTime() + COOLDOWN_MS) : null;

    return json(
      {
        ok: true,
        username: candidate,
        changesRemaining,
        nextAvailableAt: nextAvailable ? nextAvailable.toISOString() : null,
        lastChangeAt: result.lastUsernameChangeAt ? new Date(result.lastUsernameChangeAt).toISOString() : null,
      },
      200
    );
  } catch (e: unknown) {
    if (isApiAuthError(e)) {
      return json({ error: e.code, message: e.message }, e.status);
    }

    if (isSecuritySettingsStoreError(e)) {
      return json({ error: e.code, message: e.message }, e.status);
    }

    return json({ error: "USERNAME_UPDATE_FAILED", message: "Unable to update username." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "PATCH, OPTIONS" } });
}

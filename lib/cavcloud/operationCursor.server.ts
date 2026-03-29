import "server-only";

import type { Prisma } from "@prisma/client";

export type CavCloudOperationCursor = {
  createdAt: Date;
  id: string;
};

export function encodeCavCloudOperationCursor(row: { createdAt: Date; id: string } | null | undefined): string | null {
  if (!row?.id || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())) return null;
  const payload = JSON.stringify({
    t: row.createdAt.toISOString(),
    id: row.id,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCavCloudOperationCursor(raw: string | null): CavCloudOperationCursor | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    const id = String(parsed?.id || "").trim();
    const createdAt = new Date(String(parsed?.t || ""));
    if (!id || !Number.isFinite(createdAt.getTime())) return null;
    return {
      createdAt,
      id,
    };
  } catch {
    return null;
  }
}

export function cavcloudOperationCursorWhere(cursor: CavCloudOperationCursor | null): Prisma.CavCloudOperationLogWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      {
        createdAt: cursor.createdAt,
        id: { lt: cursor.id },
      },
    ],
  };
}


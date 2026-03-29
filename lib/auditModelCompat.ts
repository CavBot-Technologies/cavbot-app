import { Prisma } from "@prisma/client";

type UserIdFieldName = "actorUserId" | "operatorUserId";

function resolveUserIdFieldName(modelName: "AuditLog" | "UsernameHistory"): UserIdFieldName {
  const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === modelName);
  const fieldNames = new Set((model?.fields || []).map((field) => field.name));
  return fieldNames.has("operatorUserId") ? "operatorUserId" : "actorUserId";
}

export const AUDIT_LOG_USER_ID_FIELD = resolveUserIdFieldName("AuditLog");
export const USERNAME_HISTORY_USER_ID_FIELD = resolveUserIdFieldName("UsernameHistory");

export const AUDIT_LOG_USER_ID_COLUMN_SQL = Prisma.raw(`"${AUDIT_LOG_USER_ID_FIELD}"`);

export function withAuditLogUserIdField<T extends Record<string, unknown>>(
  input: T,
  userId: string | null | undefined
): T & Record<UserIdFieldName, string | null> {
  return {
    ...input,
    [AUDIT_LOG_USER_ID_FIELD]: userId ?? null,
  } as T & Record<UserIdFieldName, string | null>;
}

export function withUsernameHistoryUserIdField<T extends Record<string, unknown>>(
  input: T,
  userId: string | null | undefined
): T & Record<UserIdFieldName, string | null> {
  return {
    ...input,
    [USERNAME_HISTORY_USER_ID_FIELD]: userId ?? null,
  } as T & Record<UserIdFieldName, string | null>;
}

export function readAuditLogUserId(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const value = (row as Record<string, unknown>)[AUDIT_LOG_USER_ID_FIELD];
  return typeof value === "string" && value.trim() ? value : null;
}

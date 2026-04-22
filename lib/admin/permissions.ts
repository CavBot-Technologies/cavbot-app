import type { StaffProfile } from "@prisma/client";

export type AdminScope =
  | "overview.read"
  | "customers.read"
  | "customers.write"
  | "accounts.read"
  | "accounts.write"
  | "plans.read"
  | "plans.write"
  | "platform.read"
  | "sessions.read"
  | "security.read"
  | "security.write"
  | "alerts.read"
  | "projects.read"
  | "sites.read"
  | "support.read"
  | "support.write"
  | "growth.read"
  | "staff.read"
  | "staff.write"
  | "audit.read"
  | "notifications.read"
  | "notifications.write"
  | "messaging.read"
  | "messaging.write"
  | "messaging.oversight"
  | "workflow.read"
  | "workflow.write"
  | "broadcast.users"
  | "broadcast.staff"
  | "settings.read"
  | "settings.write";

type StaffRole = "OWNER" | "ADMIN" | "MEMBER" | "READ_ONLY";

export const ADMIN_ALL_SCOPES: AdminScope[] = [
  "overview.read",
  "customers.read",
  "customers.write",
  "accounts.read",
  "accounts.write",
  "plans.read",
  "plans.write",
  "platform.read",
  "sessions.read",
  "security.read",
  "security.write",
  "alerts.read",
  "projects.read",
  "sites.read",
  "support.read",
  "support.write",
  "growth.read",
  "staff.read",
  "staff.write",
  "audit.read",
  "notifications.read",
  "notifications.write",
  "messaging.read",
  "messaging.write",
  "messaging.oversight",
  "workflow.read",
  "workflow.write",
  "broadcast.users",
  "broadcast.staff",
  "settings.read",
  "settings.write",
];

const DEFAULT_ROLE_SCOPES: Record<StaffRole, AdminScope[]> = {
  OWNER: ADMIN_ALL_SCOPES,
  ADMIN: ADMIN_ALL_SCOPES.filter((scope) => scope !== "settings.write"),
  MEMBER: ADMIN_ALL_SCOPES.filter((scope) => scope.endsWith(".read") && scope !== "staff.read"),
  READ_ONLY: ADMIN_ALL_SCOPES.filter((scope) => scope.endsWith(".read")),
};

function normalizeScope(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value: unknown): StaffRole {
  const role = String(value || "").trim().toUpperCase();
  if (role === "OWNER" || role === "ADMIN" || role === "READ_ONLY") return role;
  return "MEMBER";
}

export function isAdminScope(value: string): value is AdminScope {
  const normalized = normalizeScope(value);
  return ADMIN_ALL_SCOPES.includes(normalized as AdminScope);
}

export function hasAdminScope(
  staff: Pick<StaffProfile, "systemRole" | "scopes"> | { systemRole: string; scopes?: string[] | null },
  scope: AdminScope,
) {
  const role = normalizeRole(staff.systemRole);
  const explicitScopes = Array.isArray(staff.scopes)
    ? staff.scopes.map((value) => normalizeScope(value)).filter(Boolean)
    : [];

  const normalizedScope = normalizeScope(scope);
  if (explicitScopes.includes("*") || explicitScopes.includes(normalizedScope)) return true;
  return DEFAULT_ROLE_SCOPES[role].includes(scope);
}

export function hasAnyAdminScope(
  staff: Pick<StaffProfile, "systemRole" | "scopes"> | { systemRole: string; scopes?: string[] | null },
  scopes: AdminScope[],
) {
  return scopes.some((scope) => hasAdminScope(staff, scope));
}

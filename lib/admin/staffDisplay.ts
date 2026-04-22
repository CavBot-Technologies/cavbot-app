import type { Prisma } from "@prisma/client";

import { isPrimaryCavBotAdminIdentity } from "@/lib/admin/pinning";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeStaffCodeValue(value: unknown) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  return `CAV-${digits.padStart(6, "0").slice(-6)}`;
}

export function isRevokedStaffStatus(value: unknown) {
  const status = String(value || "").trim().toUpperCase();
  return status === "ARCHIVED" || status === "DISABLED";
}

export function readStaffSuspendedUntil(metadataJson: unknown) {
  const root = asRecord(metadataJson);
  const lifecycle = asRecord(root?.staffLifecycle);
  const raw = lifecycle?.suspendedUntilISO;
  if (!raw) return null;
  const parsed = new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function patchStaffLifecycleMetadata(
  metadataJson: unknown,
  patch: Record<string, Prisma.InputJsonValue | null | undefined>,
): Prisma.InputJsonValue | null {
  const root = { ...(asRecord(metadataJson) || {}) } as Record<string, Prisma.InputJsonValue | null | undefined>;
  const lifecycle = {
    ...(asRecord(root.staffLifecycle) || {}),
  } as Record<string, Prisma.InputJsonValue | null | undefined>;

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") {
      delete lifecycle[key];
    } else {
      lifecycle[key] = value;
    }
  }

  if (Object.keys(lifecycle).length) {
    root.staffLifecycle = lifecycle as Prisma.InputJsonObject;
  } else {
    delete root.staffLifecycle;
  }

  return Object.keys(root).length ? (root as Prisma.InputJsonObject) : null;
}

export type StaffLifecycleState = "ACTIVE" | "LEAVE" | "OFFBOARDING";

export function normalizeStaffLifecycleState(value: unknown): StaffLifecycleState {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "LEAVE") return "LEAVE";
  if (normalized === "OFFBOARDING") return "OFFBOARDING";
  return "ACTIVE";
}

export function readStaffLifecycleState(metadataJson: unknown): StaffLifecycleState {
  const root = asRecord(metadataJson);
  const lifecycle = asRecord(root?.staffLifecycle);
  return normalizeStaffLifecycleState(lifecycle?.employmentState);
}

export function formatStaffLifecycleStateLabel(value: unknown) {
  const normalized = normalizeStaffLifecycleState(value);
  if (normalized === "OFFBOARDING") return "Offboarding";
  if (normalized === "LEAVE") return "Leave";
  return "Active";
}

export function resolveDisplayStaffStatus(
  status: unknown,
  metadataJson?: unknown,
  now = new Date(),
) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "SUSPENDED") {
    const suspendedUntil = readStaffSuspendedUntil(metadataJson);
    if (suspendedUntil && suspendedUntil.getTime() <= now.getTime()) {
      return "ACTIVE";
    }
  }
  if (isRevokedStaffStatus(normalized)) return "REVOKED";
  if (normalized === "ACTIVE" || normalized === "INVITED" || normalized === "SUSPENDED") {
    return normalized;
  }
  return normalized || "INVITED";
}

export function formatStaffStatusLabel(
  status: unknown,
  metadataJson?: unknown,
  now = new Date(),
) {
  const normalized = resolveDisplayStaffStatus(status, metadataJson, now);
  if (normalized === "READ_ONLY") return "Read only";
  return normalized
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatStaffSystemRoleLabel(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "READ_ONLY") return "Read only";
  return normalized
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function hasStaffLeadershipStar(input: {
  positionTitle?: unknown;
  department?: unknown;
  systemRole?: unknown;
}) {
  const normalizedRole = String(input.systemRole || "").trim().toUpperCase();
  const normalizedPosition = String(input.positionTitle || "").trim().toLowerCase();
  const normalizedDepartment = String(input.department || "").trim().toLowerCase();

  return (
    normalizedRole === "OWNER"
    || normalizedPosition === "board of directors"
    || normalizedDepartment === "board of directors"
  );
}

export type StaffDepartmentAvatarTone = "blue" | "orange" | "lime" | "violet" | "navy";

export function getDepartmentAvatarTone(department: unknown): StaffDepartmentAvatarTone {
  const normalizedDepartment = String(department || "").trim().toUpperCase();

  if (normalizedDepartment === "COMMAND") return "blue";
  if (normalizedDepartment === "OPERATIONS") return "orange";
  if (normalizedDepartment === "SECURITY") return "lime";
  if (normalizedDepartment === "HUMAN_RESOURCES") return "violet";

  return "navy";
}

export function isProtectedStaffIdentity(input: {
  staffCode?: unknown;
  systemRole?: unknown;
  email?: unknown;
  username?: unknown;
  name?: unknown;
}) {
  const normalizedRole = String(input.systemRole || "").trim().toUpperCase();
  if (normalizedRole === "OWNER") return true;
  return isPrimaryCavBotAdminIdentity({
    email: String(input.email || ""),
    username: String(input.username || ""),
    name: String(input.name || ""),
  });
}

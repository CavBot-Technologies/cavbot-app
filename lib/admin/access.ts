import { ADMIN_ALL_SCOPES, hasAdminScope, isAdminScope, type AdminScope } from "@/lib/admin/permissions";
import { sanitizeAdminNextPath } from "@/lib/admin/config";

export type AdminDepartment =
  | "COMMAND"
  | "OPERATIONS"
  | "SECURITY"
  | "HUMAN_RESOURCES";

export type AdminNavItem = {
  href: string;
  label: string;
  sub: string;
  scope: AdminScope;
};

export type AdminNavSection = {
  label: string;
  items: AdminNavItem[];
};

export const ADMIN_DEPARTMENT_OPTIONS: Array<{ value: AdminDepartment; label: string }> = [
  { value: "COMMAND", label: "Command" },
  { value: "OPERATIONS", label: "Operations" },
  { value: "SECURITY", label: "Security" },
  { value: "HUMAN_RESOURCES", label: "Human Resources" },
];

const DEPARTMENT_MARKERS: Record<AdminDepartment, string> = {
  COMMAND: "department:command",
  OPERATIONS: "department:operations",
  SECURITY: "department:security",
  HUMAN_RESOURCES: "department:human_resources",
};

const DEPARTMENT_LABELS: Record<AdminDepartment, string> = {
  COMMAND: "Command",
  OPERATIONS: "Operations",
  SECURITY: "Security",
  HUMAN_RESOURCES: "Human Resources",
};

const DEPARTMENT_DEFAULT_PATHS: Record<AdminDepartment, string> = {
  COMMAND: "/overview",
  OPERATIONS: "/clients",
  SECURITY: "/security",
  HUMAN_RESOURCES: "/staff",
};

export const ADMIN_NAV: AdminNavSection[] = [
  {
    label: "Command",
    items: [
      { href: "/overview", label: "Overview", sub: "Executive command center", scope: "overview.read" },
      { href: "/plans", label: "Financials", sub: "Revenue and subscription control", scope: "plans.read" },
      { href: "/growth", label: "Growth", sub: "Acquisition and conversion", scope: "growth.read" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/accounts", label: "Accounts", sub: "Workspace dossiers and health", scope: "accounts.read" },
      { href: "/clients", label: "Clients", sub: "Users, activation, retention", scope: "customers.read" },
      { href: "/projects", label: "Projects", sub: "Project usage and issues", scope: "projects.read" },
      { href: "/404-recovery", label: "404 Arcade", sub: "Recovery games and route telemetry", scope: "projects.read" },
      { href: "/sessions", label: "Sessions", sub: "Observed and recovered activity", scope: "sessions.read" },
      { href: "/cavai", label: "CavAi", sub: "Prompts, models, companion, and Caven", scope: "platform.read" },
      { href: "/ai-agents", label: "Ai Agents", sub: "Created agents, usage, and publication", scope: "platform.read" },
      { href: "/storage", label: "Storage", sub: "CavCloud, CavSafe, files, and deletes", scope: "accounts.read" },
      { href: "/api-and-key", label: "API & Key", sub: "Keys, widgets, badges, and games", scope: "platform.read" },
      { href: "/platform", label: "Platform", sub: "Core engine room and status", scope: "platform.read" },
      { href: "/alerts", label: "Alerts", sub: "Notices, incidents, and spikes", scope: "alerts.read" },
      { href: "/support", label: "Intervention", sub: "Billing risk, onboarding, and client action", scope: "support.read" },
    ],
  },
  {
    label: "Security",
    items: [
      { href: "/security", label: "Security", sub: "Security overview and incidents", scope: "security.read" },
      { href: "/cases", label: "Case Management", sub: "Queues, assignees, and outcomes", scope: "security.read" },
      { href: "/security/trust", label: "Trust & Safety", sub: "Discipline, recovery, and investigations", scope: "security.read" },
      { href: "/security/cavverify", label: "Caverify", sub: "Challenge traffic and outcomes", scope: "security.read" },
      { href: "/security/cavguard", label: "CavGuard", sub: "Guard decisions and overrides", scope: "security.read" },
    ],
  },
  {
    label: "Human Resources",
    items: [
      { href: "/staff", label: "Team", sub: "Lifecycle, placement, and staffing", scope: "staff.read" },
      { href: "/staff-lifecycle", label: "Team Lifecycle", sub: "Onboarding, moves, leave, and offboarding", scope: "staff.read" },
      { href: "/broadcasts", label: "Team Broadcasts", sub: "Internal notices and mail fanout", scope: "notifications.read" },
      { href: "/message-oversight", label: "Message Oversight", sub: "Team inbox review, safety checks, and archives", scope: "messaging.oversight" },
      { href: "/audit", label: "Audit", sub: "Sensitive action trail and evidence", scope: "audit.read" },
    ],
  },
];

const adminNavRouteScopes: Array<{ href: string; scope: AdminScope }> = [];

for (const section of ADMIN_NAV) {
  for (const item of section.items) {
    adminNavRouteScopes.push({ href: item.href, scope: item.scope });
  }
}

const ADMIN_ROUTE_SCOPES: Array<{ href: string; scope: AdminScope }> = [
  ...adminNavRouteScopes,
  { href: "/staff", scope: "staff.read" as AdminScope },
  { href: "/audit", scope: "audit.read" as AdminScope },
  { href: "/settings", scope: "settings.read" as AdminScope },
].sort((left, right) => right.href.length - left.href.length);

const DEPARTMENT_SCOPE_PRESETS: Record<AdminDepartment, AdminScope[]> = {
  COMMAND: ADMIN_ALL_SCOPES,
  OPERATIONS: [
    "customers.read",
    "customers.write",
    "accounts.read",
    "accounts.write",
    "plans.read",
    "plans.write",
    "platform.read",
    "sessions.read",
    "alerts.read",
    "projects.read",
    "sites.read",
    "support.read",
    "support.write",
    "notifications.read",
    "notifications.write",
    "messaging.read",
    "messaging.write",
    "workflow.read",
    "workflow.write",
    "broadcast.users",
  ],
  SECURITY: [
    "accounts.read",
    "customers.read",
    "support.read",
    "support.write",
    "security.read",
    "security.write",
    "messaging.read",
    "messaging.write",
    "workflow.read",
    "workflow.write",
  ],
  HUMAN_RESOURCES: [
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
    "broadcast.staff",
  ],
};

function normalizeDepartmentToken(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeScopeValue(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeAdminDepartment(value: unknown): AdminDepartment {
  const token = normalizeDepartmentToken(value);
  if (token === "operations") return "OPERATIONS";
  if (token === "security") return "SECURITY";
  if (token === "human resources" || token === "human resource" || token === "hr") {
    return "HUMAN_RESOURCES";
  }
  return "COMMAND";
}

export function formatAdminDepartmentLabel(value: AdminDepartment) {
  return DEPARTMENT_LABELS[value];
}

export function getAdminDepartmentMarker(value: AdminDepartment) {
  return DEPARTMENT_MARKERS[value];
}

export function buildAdminDepartmentScopeSet(value: AdminDepartment) {
  const marker = getAdminDepartmentMarker(value);
  const preset = value === "COMMAND" ? ["*"] : DEPARTMENT_SCOPE_PRESETS[value];
  return [marker, ...preset];
}

export function resolveAdminDepartment(staff: { scopes?: string[] | null; systemRole?: string | null }) {
  const values = Array.isArray(staff.scopes) ? staff.scopes.map((value) => normalizeScopeValue(value)) : [];
  for (const department of Object.keys(DEPARTMENT_MARKERS) as AdminDepartment[]) {
    if (values.includes(DEPARTMENT_MARKERS[department])) return department;
  }
  if (values.includes("*")) return "COMMAND";
  return "COMMAND";
}

export function getAdminDepartmentPresetScopes(value: AdminDepartment) {
  return [...DEPARTMENT_SCOPE_PRESETS[value]];
}

export function getAdminExtraScopes(
  scopes: string[] | null | undefined,
  department: AdminDepartment,
) {
  const preset = new Set(
    department === "COMMAND"
      ? ["*"]
      : DEPARTMENT_SCOPE_PRESETS[department].map((scope) => normalizeScopeValue(scope)),
  );
  const marker = DEPARTMENT_MARKERS[department];
  return (Array.isArray(scopes) ? scopes : [])
    .map((value) => normalizeScopeValue(value))
    .filter((value) => value && value !== marker && !preset.has(value) && isAdminScope(value));
}

export function getDefaultAdminPathForDepartment(value: AdminDepartment) {
  return DEPARTMENT_DEFAULT_PATHS[value];
}

export function getDefaultAdminPathForStaff(staff: { scopes?: string[] | null; systemRole?: string | null }) {
  return getDefaultAdminPathForDepartment(resolveAdminDepartment(staff));
}

function getScopeForAdminPath(pathname: string) {
  for (const route of ADMIN_ROUTE_SCOPES) {
    if (pathname === route.href || pathname.startsWith(`${route.href}/`)) {
      return route.scope;
    }
  }
  return null;
}

export function isAdminPathAllowed(
  staff: { systemRole: string; scopes?: string[] | null },
  pathname: string,
) {
  const scope = getScopeForAdminPath(pathname);
  if (!scope) return pathname === "/";
  return hasAdminScope(staff, scope);
}

export function resolveAdminNextPath(
  staff: { systemRole: string; scopes?: string[] | null },
  requestedPath: string | null | undefined,
) {
  const sanitized = sanitizeAdminNextPath(requestedPath);
  if (sanitized === "/") return getDefaultAdminPathForStaff(staff);
  if (isAdminPathAllowed(staff, sanitized)) return sanitized;
  return getDefaultAdminPathForStaff(staff);
}

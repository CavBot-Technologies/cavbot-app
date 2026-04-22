export type AdminSignupMethod = "cavbot" | "google" | "github";

type SignupIdentity = {
  provider?: string | null;
  createdAt?: Date | string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeAdminSignupMethod(raw: unknown): AdminSignupMethod | null {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  if (value.includes("google")) return "google";
  if (value.includes("github")) return "github";
  if (value.includes("cavbot") || value.includes("register") || value.includes("password") || value.includes("email")) {
    return "cavbot";
  }
  return null;
}

export function formatAdminSignupMethodLabel(method: AdminSignupMethod) {
  if (method === "google") return "Google";
  if (method === "github") return "GitHub";
  return "CavBot";
}

export function resolveAdminSignupMethod(args: {
  accountCreatedMeta?: unknown;
  identities?: SignupIdentity[] | null;
}): AdminSignupMethod {
  const auditMeta = asRecord(args.accountCreatedMeta);
  const auditProvider = normalizeAdminSignupMethod(auditMeta?.provider);
  if (auditProvider) return auditProvider;
  if (auditMeta) return "cavbot";

  const earliestIdentity = (args.identities || [])
    .map((identity) => {
      const method = normalizeAdminSignupMethod(identity.provider);
      const createdAt = identity.createdAt ? new Date(identity.createdAt) : null;
      return {
        method,
        createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
      };
    })
    .filter((identity): identity is { method: AdminSignupMethod; createdAt: Date | null } => Boolean(identity.method))
    .sort((left, right) => {
      const leftTime = left.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })[0];

  return earliestIdentity?.method || "cavbot";
}

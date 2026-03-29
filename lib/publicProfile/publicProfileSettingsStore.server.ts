import "server-only";

export type PublicProfileSettings = {
  publicProfileEnabled: boolean;
  publicShowReadme: boolean;
  publicShowWorkspaceSnapshot: boolean;
  publicShowHealthOverview: boolean;
  publicShowCapabilities: boolean;
  publicShowArtifacts: boolean;
  publicShowPlanTier: boolean;
  publicShowBio: boolean;
  publicShowIdentityLinks: boolean;
  publicShowIdentityLocation: boolean;
  publicShowIdentityEmail: boolean;
  publicWorkspaceId: string | null;
};

export const DEFAULT_PUBLIC_PROFILE_SETTINGS: PublicProfileSettings = {
  // Public is the default posture; "Private mode" is the inverted UI toggle.
  publicProfileEnabled: true,
  publicShowReadme: true,
  publicShowWorkspaceSnapshot: true,
  publicShowHealthOverview: true,
  publicShowCapabilities: true,
  publicShowArtifacts: true,
  publicShowPlanTier: true,
  publicShowBio: true,
  publicShowIdentityLinks: true,
  publicShowIdentityLocation: true,
  // Email is always opt-in; never default it on.
  publicShowIdentityEmail: false,
  publicWorkspaceId: null,
};

type RawDb = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...params: unknown[]) => Promise<T>;
};

const ALLOW_FALLBACK_STORE = process.env.NODE_ENV !== "production";

let _tableReady: boolean | null = null;

async function ensureTable(db: RawDb) {
  if (!ALLOW_FALLBACK_STORE) return;
  if (_tableReady) return;

  const sql = `
CREATE TABLE IF NOT EXISTS user_public_profile_settings (
  user_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  show_readme BOOLEAN NOT NULL DEFAULT true,
  show_workspace_snapshot BOOLEAN NOT NULL DEFAULT true,
  show_health_overview BOOLEAN NOT NULL DEFAULT true,
  show_capabilities BOOLEAN NOT NULL DEFAULT true,
  show_artifacts BOOLEAN NOT NULL DEFAULT true,
  show_plan_tier BOOLEAN NOT NULL DEFAULT true,
  show_bio BOOLEAN NOT NULL DEFAULT true,
  show_identity_links BOOLEAN NOT NULL DEFAULT true,
  show_identity_location BOOLEAN NOT NULL DEFAULT true,
  show_identity_email BOOLEAN NOT NULL DEFAULT false,
  workspace_id TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;
  try {
    await db.$executeRawUnsafe(sql);
    // Older dev DBs may have the table without newer columns.
    await db.$executeRawUnsafe(
      "ALTER TABLE user_public_profile_settings ADD COLUMN IF NOT EXISTS show_readme BOOLEAN NOT NULL DEFAULT true"
    );
    await db.$executeRawUnsafe(
      "ALTER TABLE user_public_profile_settings ADD COLUMN IF NOT EXISTS show_identity_links BOOLEAN NOT NULL DEFAULT true"
    );
    await db.$executeRawUnsafe(
      "ALTER TABLE user_public_profile_settings ADD COLUMN IF NOT EXISTS show_identity_location BOOLEAN NOT NULL DEFAULT true"
    );
    await db.$executeRawUnsafe(
      "ALTER TABLE user_public_profile_settings ADD COLUMN IF NOT EXISTS show_identity_email BOOLEAN NOT NULL DEFAULT false"
    );
    _tableReady = true;
  } catch {
    // Fail closed: no persistence if DDL is blocked.
    _tableReady = false;
  }
}

function toBool(v: unknown, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}

function toStrOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export async function readPublicProfileSettingsFallback(db: RawDb, userId: string): Promise<PublicProfileSettings> {
  if (!ALLOW_FALLBACK_STORE) return { ...DEFAULT_PUBLIC_PROFILE_SETTINGS };
  await ensureTable(db);
  if (_tableReady === false) return { ...DEFAULT_PUBLIC_PROFILE_SETTINGS };

  try {
    const rows = await db.$queryRaw<
      Array<{
        enabled: boolean;
        show_readme: boolean;
        show_workspace_snapshot: boolean;
        show_health_overview: boolean;
        show_capabilities: boolean;
        show_artifacts: boolean;
        show_plan_tier: boolean;
        show_bio: boolean;
        show_identity_links: boolean;
        show_identity_location: boolean;
        show_identity_email: boolean;
        workspace_id: string | null;
      }>
    >`SELECT enabled, show_readme, show_workspace_snapshot, show_health_overview, show_capabilities, show_artifacts, show_plan_tier, show_bio, show_identity_links, show_identity_location, show_identity_email, workspace_id
      FROM user_public_profile_settings
      WHERE user_id = ${userId}
      LIMIT 1`;

    const r = rows?.[0];
    if (!r) return { ...DEFAULT_PUBLIC_PROFILE_SETTINGS };

    return {
      publicProfileEnabled: toBool(r.enabled, true),
      publicShowReadme: toBool(r.show_readme, true),
      publicShowWorkspaceSnapshot: toBool(r.show_workspace_snapshot, true),
      publicShowHealthOverview: toBool(r.show_health_overview, true),
      publicShowCapabilities: toBool(r.show_capabilities, true),
      publicShowArtifacts: toBool(r.show_artifacts, true),
      publicShowPlanTier: toBool(r.show_plan_tier, true),
      publicShowBio: toBool(r.show_bio, true),
      publicShowIdentityLinks: toBool(r.show_identity_links, true),
      publicShowIdentityLocation: toBool(r.show_identity_location, true),
      publicShowIdentityEmail: toBool(r.show_identity_email, false),
      publicWorkspaceId: toStrOrNull(r.workspace_id),
    };
  } catch {
    return { ...DEFAULT_PUBLIC_PROFILE_SETTINGS };
  }
}

export async function writePublicProfileSettingsFallback(
  db: RawDb,
  userId: string,
  patch: Partial<PublicProfileSettings>
): Promise<PublicProfileSettings> {
  if (!ALLOW_FALLBACK_STORE) return { ...DEFAULT_PUBLIC_PROFILE_SETTINGS };
  await ensureTable(db);
  if (_tableReady === false) return { ...DEFAULT_PUBLIC_PROFILE_SETTINGS };

  const next: PublicProfileSettings = {
    ...DEFAULT_PUBLIC_PROFILE_SETTINGS,
    ...(await readPublicProfileSettingsFallback(db, userId)),
    ...patch,
  };

  try {
    await db.$queryRaw`
      INSERT INTO user_public_profile_settings (
        user_id,
        enabled,
        show_readme,
        show_workspace_snapshot,
        show_health_overview,
        show_capabilities,
        show_artifacts,
        show_plan_tier,
        show_bio,
        show_identity_links,
        show_identity_location,
        show_identity_email,
        workspace_id,
        updated_at
      ) VALUES (
        ${userId},
        ${next.publicProfileEnabled},
        ${next.publicShowReadme},
        ${next.publicShowWorkspaceSnapshot},
        ${next.publicShowHealthOverview},
        ${next.publicShowCapabilities},
        ${next.publicShowArtifacts},
        ${next.publicShowPlanTier},
        ${next.publicShowBio},
        ${next.publicShowIdentityLinks},
        ${next.publicShowIdentityLocation},
        ${next.publicShowIdentityEmail},
        ${next.publicWorkspaceId},
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        show_readme = EXCLUDED.show_readme,
        show_workspace_snapshot = EXCLUDED.show_workspace_snapshot,
        show_health_overview = EXCLUDED.show_health_overview,
        show_capabilities = EXCLUDED.show_capabilities,
        show_artifacts = EXCLUDED.show_artifacts,
        show_plan_tier = EXCLUDED.show_plan_tier,
        show_bio = EXCLUDED.show_bio,
        show_identity_links = EXCLUDED.show_identity_links,
        show_identity_location = EXCLUDED.show_identity_location,
        show_identity_email = EXCLUDED.show_identity_email,
        workspace_id = EXCLUDED.workspace_id,
        updated_at = NOW()
    `;
  } catch {
    // Fall back to returning computed state; caller can still render but won't persist.
  }

  return next;
}

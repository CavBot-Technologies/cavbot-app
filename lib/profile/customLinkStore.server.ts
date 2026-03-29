import "server-only";

type RawDb = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...params: unknown[]) => Promise<T>;
};

// Dev bootstrap only. In production, this should live on User.customLinkUrl via migrations.
const ALLOW_FALLBACK_STORE = process.env.NODE_ENV !== "production";

let _tableReady: boolean | null = null;

async function ensureTable(db: RawDb) {
  if (!ALLOW_FALLBACK_STORE) return;
  if (_tableReady) return;

  const sql = `
CREATE TABLE IF NOT EXISTS user_custom_profile_links (
  user_id TEXT PRIMARY KEY,
  custom_link_url TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

  try {
    await db.$executeRawUnsafe(sql);
    _tableReady = true;
  } catch {
    _tableReady = false;
  }
}

export async function readCustomLinkUrlFallback(db: RawDb, userId: string): Promise<string | null> {
  if (!ALLOW_FALLBACK_STORE) return null;
  await ensureTable(db);
  if (_tableReady === false) return null;

  try {
    const rows = await db.$queryRaw<Array<{ custom_link_url: string | null }>>`
      SELECT custom_link_url
      FROM user_custom_profile_links
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    const v = rows?.[0]?.custom_link_url ?? null;
    const s = String(v ?? "").trim();
    return s ? s : null;
  } catch {
    return null;
  }
}

export async function writeCustomLinkUrlFallback(
  db: RawDb,
  userId: string,
  value: string | null
): Promise<string | null> {
  if (!ALLOW_FALLBACK_STORE) return null;
  await ensureTable(db);
  if (_tableReady === false) return null;

  const next = (() => {
    const s = String(value ?? "").trim();
    return s ? s : null;
  })();

  try {
    await db.$queryRaw`
      INSERT INTO user_custom_profile_links (user_id, custom_link_url, updated_at)
      VALUES (${userId}, ${next}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        custom_link_url = EXCLUDED.custom_link_url,
        updated_at = NOW()
    `;
  } catch {
    // Best effort; return computed value even if DB write fails.
  }

  return next;
}

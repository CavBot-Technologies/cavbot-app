-- PublicProfileReadme (system-owned; not CavCloud storage)
CREATE TABLE IF NOT EXISTS "PublicProfileReadme" (
  "userId" TEXT NOT NULL PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "markdown" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "PublicProfileReadme_userId_idx" ON "PublicProfileReadme"("userId");


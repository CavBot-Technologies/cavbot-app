-- Optional custom identity link for profiles (renders only when set)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customLinkUrl" VARCHAR(200);

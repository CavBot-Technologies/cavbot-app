-- Finder-grade text/code thumbnail support
ALTER TABLE "CavCloudFile"
  ADD COLUMN "previewSnippet" TEXT,
  ADD COLUMN "previewSnippetUpdatedAt" TIMESTAMP(3);

ALTER TABLE "CavSafeFile"
  ADD COLUMN "previewSnippet" TEXT,
  ADD COLUMN "previewSnippetUpdatedAt" TIMESTAMP(3);

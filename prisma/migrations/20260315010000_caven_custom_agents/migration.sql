-- Caven custom agents + installed agent persistence

ALTER TABLE "CavenSettings"
  ADD COLUMN IF NOT EXISTS "installedAgentIds" JSONB NOT NULL DEFAULT '["error_explainer","fix_draft","safe_refactor","code_explainer","file_summarizer","dictate"]'::jsonb;

ALTER TABLE "CavenSettings"
  ADD COLUMN IF NOT EXISTS "customAgents" JSONB NOT NULL DEFAULT '[]'::jsonb;

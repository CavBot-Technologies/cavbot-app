-- Image Studio storage schema
-- Formalizes the raw SQL bootstrap tables so production deploys can provision
-- storage ahead of runtime while keeping the migration safe for environments
-- where some tables were already created manually.

CREATE TABLE IF NOT EXISTS image_presets (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  subtitle TEXT,
  thumbnail_url TEXT,
  category TEXT NOT NULL,
  generation_prompt_template TEXT NOT NULL,
  edit_prompt_template TEXT NOT NULL,
  negative_prompt TEXT,
  plan_tier VARCHAR(32) NOT NULL DEFAULT 'premium',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS image_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id VARCHAR(120),
  request_id VARCHAR(120),
  plan_tier VARCHAR(32) NOT NULL,
  mode VARCHAR(24) NOT NULL,
  action_source VARCHAR(64),
  agent_id VARCHAR(64),
  agent_action_key VARCHAR(64),
  prompt TEXT NOT NULL,
  resolved_prompt TEXT NOT NULL,
  preset_id TEXT,
  model_used VARCHAR(120) NOT NULL,
  status VARCHAR(24) NOT NULL,
  errors TEXT,
  input_asset_refs JSONB,
  output_asset_refs JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  job_id TEXT,
  preset_id TEXT,
  source_kind VARCHAR(64) NOT NULL,
  original_source VARCHAR(64),
  file_name VARCHAR(280),
  mime_type VARCHAR(120) NOT NULL DEFAULT 'image/png',
  bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  format VARCHAR(40),
  file_location TEXT,
  cavcloud_file_id VARCHAR(120),
  cavcloud_key TEXT,
  cavsafe_file_id VARCHAR(120),
  cavsafe_key TEXT,
  external_url TEXT,
  data_url TEXT,
  b64_data TEXT,
  source_prompt TEXT,
  metadata_json JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS preset_id TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS source_kind VARCHAR(64) NOT NULL DEFAULT 'generated';
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS original_source VARCHAR(64);
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS file_name VARCHAR(280);
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS mime_type VARCHAR(120) NOT NULL DEFAULT 'image/png';
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS format VARCHAR(40);
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS file_location TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS cavcloud_file_id VARCHAR(120);
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS cavcloud_key TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS cavsafe_file_id VARCHAR(120);
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS cavsafe_key TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS data_url TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS b64_data TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS source_prompt TEXT;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS metadata_json JSONB;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS user_image_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  job_id TEXT,
  asset_id TEXT,
  entry_type VARCHAR(48) NOT NULL,
  mode VARCHAR(24),
  prompt_summary TEXT,
  saved BOOLEAN NOT NULL DEFAULT FALSE,
  saved_target VARCHAR(32),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS asset_id TEXT;
ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS entry_type VARCHAR(48) NOT NULL DEFAULT 'history';
ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS mode VARCHAR(24);
ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS prompt_summary TEXT;
ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS saved_target VARCHAR(32);
ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE user_image_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS agent_install_state (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  surface VARCHAR(24) NOT NULL,
  agent_id VARCHAR(64) NOT NULL,
  installed BOOLEAN NOT NULL DEFAULT TRUE,
  plan_tier VARCHAR(32) NOT NULL,
  metadata_json JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, user_id, surface, agent_id)
);

CREATE INDEX IF NOT EXISTS image_presets_active_order_idx
ON image_presets (is_active, display_order, updated_at);

CREATE INDEX IF NOT EXISTS image_jobs_account_user_created_idx
ON image_jobs (account_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS image_jobs_account_user_status_idx
ON image_jobs (account_id, user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS image_assets_account_user_created_idx
ON image_assets (account_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_image_history_account_user_created_idx
ON user_image_history (account_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_image_history_account_user_saved_idx
ON user_image_history (account_id, user_id, saved, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_install_state_lookup_idx
ON agent_install_state (account_id, user_id, surface, installed, updated_at DESC);

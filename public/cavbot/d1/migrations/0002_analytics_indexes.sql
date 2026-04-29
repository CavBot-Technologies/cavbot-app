CREATE INDEX IF NOT EXISTS idx_project_keys_hash ON project_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_project_keys_project ON project_keys (project_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_project_origin ON sites (project_id, origin);
CREATE INDEX IF NOT EXISTS idx_sites_project_public ON sites (project_id, public_id);
CREATE INDEX IF NOT EXISTS idx_sites_project_active ON sites (project_id, is_active);

CREATE INDEX IF NOT EXISTS idx_events_project_created ON events (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_project_site_created ON events (project_id, site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_project_name_created ON events (project_id, event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_events_project_route_created ON events (project_id, route_path, created_at);
CREATE INDEX IF NOT EXISTS idx_events_project_session_created ON events (project_id, session_key, created_at);
CREATE INDEX IF NOT EXISTS idx_events_legacy_key_created ON events (project_key, created_at);

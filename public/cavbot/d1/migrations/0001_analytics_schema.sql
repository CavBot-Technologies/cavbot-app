CREATE TABLE IF NOT EXISTS project_keys (
  project_id INTEGER NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'ingest',
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  host TEXT,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  site_id INTEGER,
  anonymous_id TEXT,
  session_key TEXT,
  page_url TEXT,
  route_path TEXT,
  page_type TEXT,
  component TEXT,
  referrer TEXT,
  user_agent TEXT,
  event_name TEXT NOT NULL,
  event_timestamp TEXT NOT NULL,
  payload_json TEXT,
  project_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

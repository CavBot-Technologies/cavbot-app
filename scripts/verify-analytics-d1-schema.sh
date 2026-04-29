#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-/tmp/cavbot_analytics_d1.db}"
SCHEMA_SQL="public/cavbot/d1/migrations/0001_analytics_schema.sql"
INDEX_SQL="public/cavbot/d1/migrations/0002_analytics_indexes.sql"

rm -f "$DB_PATH"
sqlite3 "$DB_PATH" < "$SCHEMA_SQL"
sqlite3 "$DB_PATH" < "$INDEX_SQL"

echo "[ok] applied analytics schema to $DB_PATH"

echo "[tables]"
sqlite3 "$DB_PATH" ".tables"

echo "[indexes: project_keys]"
sqlite3 "$DB_PATH" "PRAGMA index_list('project_keys');"

echo "[indexes: sites]"
sqlite3 "$DB_PATH" "PRAGMA index_list('sites');"

echo "[indexes: events]"
sqlite3 "$DB_PATH" "PRAGMA index_list('events');"

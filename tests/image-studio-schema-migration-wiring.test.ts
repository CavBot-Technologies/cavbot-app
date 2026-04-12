import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("Image Studio storage is provisioned by prisma migration instead of runtime bootstrap only", () => {
  const sql = read("prisma/migrations/20260412111500_image_studio_storage_schema/migration.sql");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS image_presets \(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS image_jobs \(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS image_assets \(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_image_history \(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agent_install_state \(/);

  assert.match(sql, /CREATE INDEX IF NOT EXISTS image_presets_active_order_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS image_jobs_account_user_created_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS image_jobs_account_user_status_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS image_assets_account_user_created_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS user_image_history_account_user_created_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS user_image_history_account_user_saved_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS agent_install_state_lookup_idx/);
});

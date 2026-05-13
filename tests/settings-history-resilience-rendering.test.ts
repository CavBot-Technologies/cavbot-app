import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("settings history route fails open with a current session payload", () => {
  const source = read("app/api/settings/history/route.ts");

  assert.equal(source.includes("requireSettingsOwnerResilientSession"), true);
  assert.equal(source.includes("HISTORY_RESPONSE_TIMEOUT_MS"), true);
  assert.equal(source.includes("withHistoryDeadline"), true);
  assert.equal(source.includes("buildCurrentSessionHistoryEntry"), true);
  assert.equal(source.includes('actionLabel: "Current session"'), true);
  assert.equal(source.includes("readRequestGeo(req)"), true);
  assert.equal(source.includes("geoRegion: geo.region"), true);
  assert.equal(source.includes("detectBrowser(userAgent)"), true);
  assert.equal(source.includes("degraded: true"), true);
});

test("settings history client renders browser identity and region metadata", () => {
  const client = read("app/settings/sections/HistoryClient.tsx");
  const css = read("app/settings/settings.css");

  assert.equal(client.includes("function BrowserIcon"), true);
  assert.equal(client.includes("resolveBrowser(entry)"), true);
  assert.equal(client.includes("resolveRegion(entry)"), true);
  assert.equal(client.includes("<strong>REGION</strong>"), true);
  assert.equal(client.includes("<strong>LOCATION</strong>"), true);
  assert.equal(client.includes("browserDisplayName(browser)"), true);
  assert.equal(css.includes(".hx-browserIcon"), true);
  assert.equal(css.includes(".hx-browserValue"), true);
});

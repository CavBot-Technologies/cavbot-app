import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavtools boot warms context before declaring the command plane ready", () => {
  const source = read("app/cavtools/page.tsx");

  assert.equal(source.includes('type BootPhase = "mounting" | "context-loading" | "ready" | "limited";'), true);
  assert.equal(source.includes('const [bootPhase, setBootPhase] = useState<BootPhase>("mounting");'), true);
  assert.equal(source.includes('const [activeProjectId, setActiveProjectId] = useState<number | null>(initialProjectId);'), true);
  assert.equal(source.includes('const statusResult = await callExec("cav status");'), true);
  assert.equal(source.includes('applyExecResult(statusResult, { renderOutput: false, updateCwd: false, logEvent: false });'), true);
  assert.equal(source.includes("const nextCanUseCavsafe = Boolean(statusResult.actor?.includeCavsafe);"), true);
  assert.equal(source.includes('shouldRefreshRoot(root, { activeProjectId: nextProjectId, canUseCavsafe: nextCanUseCavsafe })'), true);
  assert.equal(source.includes('refreshDirectory(root.path, { silent: true, logEvent: false })'), true);
  assert.equal(source.includes('command_unavailable: "Unavailable"'), true);
  assert.equal(source.includes('result.error?.code === "PROCESS_RUNTIME_UNAVAILABLE"'), true);
});

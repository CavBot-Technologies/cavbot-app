import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavtools explorer pre-seeds static roots and shows explicit root placeholder states", () => {
  const source = read("app/cavtools/page.tsx");

  assert.equal(source.includes("const STATIC_ROOT_ITEMS: Record<\"/telemetry\" | \"/workspace\", CavtoolsFsItem[]> = {"), true);
  assert.equal(source.includes('"/telemetry": STATIC_ROOT_ITEMS["/telemetry"],'), true);
  assert.equal(source.includes('"/workspace": STATIC_ROOT_ITEMS["/workspace"],'), true);
  assert.equal(source.includes("const [rootSyncState, setRootSyncState] = useState<Record<string, ExplorerRootState>>(INITIAL_ROOT_SYNC_STATE);"), true);
  assert.equal(source.includes("function renderRootPlaceholder(root: { namespace: CavtoolsNamespace; label: string; path: string }) {"), true);
  assert.equal(source.includes("CavSafe in CavTools requires the workspace owner session."), true);
  assert.equal(source.includes("CavSafe access requires Premium or Premium Plus on this workspace."), true);
  assert.equal(source.includes("Select or bind a project to load CavCode workspace files."), true);
  assert.equal(source.includes("Syncing {root.label} entries from the command plane."), true);
  assert.equal(source.includes("No {root.label.toLowerCase()} entries are available yet."), true);
  assert.equal(source.includes("renderRootPlaceholder(root)"), true);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function section(source: string, startToken: string, endToken?: string) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `missing token: ${startToken}`);
  const end = endToken ? source.indexOf(endToken, start + startToken.length) : -1;
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

test("cavcloud settings and collab policy reads stay on read-only account-db queries", () => {
  const settings = read("lib/cavcloud/settings.server.ts");
  const collabPolicy = read("lib/cavcloud/collabPolicy.server.ts");
  const permissions = read("lib/cavcloud/permissions.server.ts");

  const getSettings = section(
    settings,
    "export async function getCavCloudSettings(",
    "export async function updateCavCloudSettings(",
  );
  const getPolicy = section(
    collabPolicy,
    "export async function getCavCloudCollabPolicy(",
    "export async function updateCavCloudCollabPolicy(",
  );
  const resolveMembershipRole = section(
    permissions,
    "async function resolveMembershipRole(",
    "async function resolveRoleAndPolicy(",
  );

  assert.match(settings, /async function readSettingsRow/);
  assert.match(settings, /getAuthPool\(\)\.query<pg\.QueryResultRow>/);
  assert.doesNotMatch(getSettings, /ensureSettingsRow\(/);

  assert.match(collabPolicy, /async function readPolicyRow/);
  assert.match(collabPolicy, /getAuthPool\(\)\.query<pg\.QueryResultRow>/);
  assert.doesNotMatch(getPolicy, /ensurePolicyRow\(/);
  assert.doesNotMatch(getPolicy, /readAllowTeamAiAccess\(/);

  assert.match(resolveMembershipRole, /getAuthPool\(\)\.query<\{ role: string \| null \}>/);
  assert.doesNotMatch(resolveMembershipRole, /prisma\.membership\.findUnique/);
});

test("cavcloud read surfaces do not bootstrap synced folders or root writes", () => {
  const storage = read("lib/cavcloud/storage.server.ts");
  const runtimeStorage = read("lib/cavcloud/runtimeStorage.server.ts");
  const rootRoute = read("app/api/cavcloud/root/route.ts");
  const treeRoute = read("app/api/cavcloud/tree/route.ts");
  const foldersRoute = read("app/api/cavcloud/folders/route.ts");
  const folderChildrenRoute = read("app/api/cavcloud/folders/[id]/children/route.ts");

  const loadFolderChildrenPayload = section(
    storage,
    "async function loadFolderChildrenPayload(",
    "export async function getRootFolder(",
  );
  const getRootFolder = section(
    storage,
    "export async function getRootFolder(",
    "async function resolveFolderIdWithRootAlias(",
  );
  const resolveFolderIdWithRootAlias = section(
    storage,
    "async function resolveFolderIdWithRootAlias(",
    "export async function getFolderChildrenById(",
  );
  const getTreeLite = section(
    storage,
    "export async function getTreeLite(",
    "export async function getTree(",
  );
  const getTree = section(
    storage,
    "export async function getTree(",
    "export async function listGalleryFiles(",
  );

  assert.match(storage, /async function findRootFolder/);
  assert.doesNotMatch(loadFolderChildrenPayload, /ensureOfficialSyncedFolders\(/);
  assert.match(getRootFolder, /const root = await findRootFolder\(accountId\);/);
  assert.doesNotMatch(getRootFolder, /ensureOfficialSyncedFolders\(/);
  assert.doesNotMatch(getRootFolder, /ensureRootFolder\(/);
  assert.match(resolveFolderIdWithRootAlias, /const root = await findRootFolder\(accountId\);/);
  assert.doesNotMatch(resolveFolderIdWithRootAlias, /ensureOfficialSyncedFolders\(/);
  assert.doesNotMatch(resolveFolderIdWithRootAlias, /ensureRootFolder\(/);
  assert.doesNotMatch(getTreeLite, /ensureOfficialSyncedFolders\(/);
  assert.doesNotMatch(getTreeLite, /ensureRootFolder\(/);
  assert.doesNotMatch(getTree, /ensureOfficialSyncedFolders\(/);
  assert.doesNotMatch(getTree, /ensureRootFolder\(/);
  assert.match(storage, /await ensureOfficialSyncedFolders\(accountId, tx\);/);

  assert.match(runtimeStorage, /export async function ensureCavCloudRootFolderRuntime/);
  assert.match(runtimeStorage, /export async function loadCavCloudFolderChildrenByIdRuntime/);
  assert.match(runtimeStorage, /export async function loadCavCloudTreeLiteRuntime/);
  assert.match(runtimeStorage, /export async function loadCavCloudTreeRuntime/);
  assert.match(runtimeStorage, /export async function createCavCloudFolderRuntime/);
  assert.match(rootRoute, /ensureCavCloudRootFolderRuntime/);
  assert.match(rootRoute, /findCavCloudFolderByIdRuntime/);
  assert.doesNotMatch(rootRoute, /getRootFolder\(/);
  assert.match(treeRoute, /loadCavCloudTreeLiteRuntime/);
  assert.match(treeRoute, /loadCavCloudTreeRuntime/);
  assert.doesNotMatch(treeRoute, /getTreeLite\(/);
  assert.doesNotMatch(treeRoute, /getTree\(/);
  assert.match(foldersRoute, /createCavCloudFolderRuntime/);
  assert.doesNotMatch(foldersRoute, /createFolder\(/);
  assert.match(folderChildrenRoute, /loadCavCloudFolderChildrenByIdRuntime/);
  assert.match(folderChildrenRoute, /loadCavCloudTreeLiteRuntime/);
  assert.doesNotMatch(folderChildrenRoute, /getFolderChildrenById\(/);
  assert.doesNotMatch(folderChildrenRoute, /getTreeLite\(/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("ai policy enforces combined attachment caps at 2/5/10", () => {
  const source = read("src/lib/ai/ai.policy.ts");

  assert.equal(source.includes("if (planId === \"premium_plus\") return PREMIUM_PLUS_IMAGE_ATTACHMENTS_PER_PROMPT;"), true);
  assert.equal(source.includes("if (planId === \"premium\") return PREMIUM_IMAGE_ATTACHMENTS_PER_PROMPT;"), true);
  assert.equal(source.includes("return 2;"), true);
  assert.equal(source.includes("const fileAttachmentCount = asInt("), true);
  assert.equal(source.includes("const totalAttachmentCount = imageAttachmentCount + fileAttachmentCount;"), true);
});

test("ai service resolves uploaded workspace files into center and cavcode prompts", () => {
  const source = read("src/lib/ai/ai.service.ts");

  assert.equal(source.includes("async function resolveUploadedWorkspaceFilesForAi"), true);
  assert.equal(source.includes("uploadedWorkspaceFiles: uploadedWorkspaceFileMeta"), true);
  assert.equal(source.includes("\"Uploaded workspace files:\""), true);
  assert.equal(source.includes("uploadedWorkspaceFiles: uploadedFiles"), true);
  assert.equal(source.includes("fileAttachmentCount: uploadedWorkspaceFileMeta.length"), true);
});

test("caven exposes CavCloud attach modal in composer", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.equal(source.includes("const [cavCloudAttachModalOpen, setCavCloudAttachModalOpen] = useState(false);"), true);
  assert.equal(source.includes("const loadCavCloudAttachItems = useCallback(async () => {"), true);
  assert.equal(source.includes("const attachFromCavCloud = useCallback(async (file: CavCloudAttachFileItem) => {"), true);
  assert.equal(source.includes("title=\"Attach from CavCloud\""), true);
  assert.equal(source.includes("id=\"caven-cavcloud-attach-title\""), true);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("CavCode Caven menu stays usage-based for Premium states and uses the plain Caven label", () => {
  const source = fs.readFileSync(path.resolve("components/cavai/CavAiCodeWorkspace.tsx"), "utf8");

  assert.equal(
    source.includes('label: option.id === ALIBABA_QWEN_CODER_MODEL_ID ? "Caven" : resolveAiModelLabel(option.id)'),
    true,
  );
  assert.equal(source.includes('const qwenFreeLocked = qwenEntitlementState === "locked_free";'), true);
  assert.equal(source.includes('return `${creditsUsed} / ${creditsTotal} credits used`;'), true);
  assert.equal(source.includes('Number(qwenPopoverState?.usage?.creditsTotal || 0) <= 0'), false);
  assert.equal(source.includes("Not included on Free"), false);
  assert.equal(source.includes("Caven is available on Premium and Premium+."), false);
  assert.equal(source.includes("Powered by Qwen3-Coder"), false);
  assert.equal(source.includes("const showLockedTag = isQwenCoder && qwenFreeLocked;"), true);
  assert.equal(source.includes("if (isSelectionBlocked) {"), true);
  assert.equal(source.includes("Upgrade to Premium"), true);
  assert.equal(source.includes("Upgrade to Premium+"), true);
});

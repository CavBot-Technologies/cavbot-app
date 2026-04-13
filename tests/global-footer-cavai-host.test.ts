import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("root layout passes request host into the global footer mount", () => {
  const source = read("app/layout.tsx");

  assert.equal(source.includes('import { headers } from "next/headers";'), true);
  assert.equal(source.includes('const requestHost = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "";'), true);
  assert.equal(source.includes("<GlobalFooterMount initialHost={requestHost} />"), true);
});

test("global footer stays hidden on the canonical CavAi host", () => {
  const source = read("app/_components/GlobalFooterMount.tsx");

  assert.equal(source.includes('import { isCavAiCanonicalHost } from "@/lib/cavai/url";'), true);
  assert.equal(source.includes("function normalizeHost(host: string | null | undefined): string {"), true);
  assert.equal(source.includes("const hideFooterForCavAiHost = useMemo(() => isCavAiCanonicalHost(normalizedHost), [normalizedHost]);"), true);
  assert.equal(source.includes("const hideFooter = hideFooterForRoute || hideFooterForCavAiHost || modalOpen;"), true);
});

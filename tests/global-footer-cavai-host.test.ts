import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("root layout keeps shared runtime host handling server-side", () => {
  const source = read("app/layout.tsx");

  assert.equal(source.includes('import { headers } from "next/headers";'), true);
  assert.equal(source.includes('const host = headerStore.get("host");'), true);
  assert.equal(source.includes("shouldRenderSharedRootRuntime(host)"), true);
});

test("global footer stays hidden on the CavAi app route", () => {
  const source = read("app/_components/GlobalFooterMount.tsx");

  assert.equal(source.includes("function isCavAiRoute(pathname: string): boolean {"), true);
  assert.equal(source.includes('if (pathname === "/cavai" || pathname.startsWith("/cavai/")) return true;'), true);
  assert.equal(source.includes("const hideFooter = hideFooterForRoute || modalOpen;"), true);
});

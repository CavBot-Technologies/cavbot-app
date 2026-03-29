import assert from "node:assert/strict";
import test from "node:test";
import { buildCavCodeHref, resolveOpenTargetDeterministic } from "@/lib/cavai/openTargets";

test("resolver prefers cavcloud file identity before cavcode file and url fallback", async () => {
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        ok: true,
        status: "resolved",
        file: {
          fileId: "file_123",
          path: "/Synced/CavCode/src/app.ts",
          name: "app.ts",
          updatedAtISO: "2026-02-18T00:00:00.000Z",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const resolved = await resolveOpenTargetDeterministic({
    targets: [
      { kind: "url", value: "https://example.com/page", label: "Page" },
      { kind: "file", value: "/src/fallback.ts", label: "Fallback file" },
      { kind: "cavcloudFileId", value: "file_123", label: "Cloud file" },
    ],
    fetcher,
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.resolution, "cavcloud");
  assert.equal(resolved.filePath, "/Synced/CavCode/src/app.ts");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "/api/cavai/open-targets/resolve");
});

test("resolver falls back deterministically and exposes explicit no-target state", async () => {
  const noHitFetcher = async (): Promise<Response> =>
    new Response(JSON.stringify({ ok: true, status: "not_found" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const cavcodeResolved = await resolveOpenTargetDeterministic({
    targets: [
      { kind: "cavcloudPath", value: "index.ts", label: "Cloud name only" },
      { kind: "file", value: "/src/index.ts", label: "Workspace file" },
      { kind: "url", value: "https://example.com/docs", label: "Docs" },
    ],
    fetcher: noHitFetcher,
  });
  assert.equal(cavcodeResolved.ok, true);
  if (cavcodeResolved.ok) {
    assert.equal(cavcodeResolved.resolution, "cavcode");
    assert.equal(cavcodeResolved.filePath, "/src/index.ts");
  }

  const urlResolved = await resolveOpenTargetDeterministic({
    targets: [{ kind: "url", value: "https://example.com/docs", label: "Docs" }],
  });
  assert.equal(urlResolved.ok, true);
  if (urlResolved.ok) {
    assert.equal(urlResolved.resolution, "url");
    assert.equal(urlResolved.url, "https://example.com/docs");
  }

  const none = await resolveOpenTargetDeterministic({ targets: [] });
  assert.equal(none.ok, false);
  if (none.ok) return;
  assert.equal(none.reason, "no_targets");
  assert.equal(none.message, "No file target available yet.");
});

test("resolver returns ambiguous candidates without auto-picking", async () => {
  const fetcher = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        ok: true,
        status: "ambiguous",
        matches: [
          {
            fileId: "file_a",
            path: "/src/a.ts",
            name: "a.ts",
            updatedAtISO: "2026-02-18T00:00:00.000Z",
          },
          {
            fileId: "file_b",
            path: "/src/b.ts",
            name: "b.ts",
            updatedAtISO: "2026-02-18T00:00:00.000Z",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  const resolved = await resolveOpenTargetDeterministic({
    targets: [{ kind: "cavcloudPath", value: "app.ts", label: "Ambiguous target" }],
    fetcher,
  });

  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.reason, "ambiguous");
  assert.equal(resolved.candidates.length, 2);
  assert.equal(resolved.message, "Multiple matches found — choose file.");
});

test("cavcode href preserves workspace context query params", () => {
  const href = buildCavCodeHref("/src/app.ts", "?range=24h&project=7&site=abc&workspaceId=ws_1&foo=bar");
  assert.equal(href, "/cavcode?cloud=1&file=%2Fsrc%2Fapp.ts&project=7&site=abc&workspaceId=ws_1");
});

test("cavcode href preserves optional line and column context", () => {
  const href = buildCavCodeHref("/src/app.ts", "?project=7&line=42&column=9&foo=bar");
  assert.equal(href, "/cavcode?cloud=1&file=%2Fsrc%2Fapp.ts&project=7&line=42&column=9");
});

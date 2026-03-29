import assert from "node:assert/strict";
import test from "node:test";

import {
  readSanitizedJson,
  sanitizeFormData,
  sanitizeInputString,
  sanitizeUnknownDeep,
} from "@/lib/security/userInput";

test("sanitizeInputString strips control and bidi characters", () => {
  const raw = "ab\u0000cd\u202Eef";
  assert.equal(sanitizeInputString(raw), "abcdef");
});

test("sanitizeUnknownDeep strips dangerous keys and sanitizes nested strings", () => {
  const payload = sanitizeUnknownDeep({
    "__proto__": { polluted: true },
    nested: { value: "ok\u0000" },
  }) as Record<string, unknown>;

  assert.equal(Object.prototype.hasOwnProperty.call(payload, "__proto__"), false);
  assert.deepEqual(payload.nested, { value: "ok" });
});

test("readSanitizedJson sanitizes request payload", async () => {
  const req = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note: "hello\u0000", details: { text: "x\u202Ey" } }),
  });

  const body = (await readSanitizedJson(req, null)) as Record<string, unknown> | null;
  assert.ok(body);
  assert.equal(body?.note, "hello");
  assert.deepEqual(body?.details, { text: "xy" });
});

test("sanitizeFormData sanitizes string fields and uploaded file name", () => {
  const form = new FormData();
  form.append("title", "my\u0000 title");
  form.append("file", new File(["x"], "re\u0000port.txt", { type: "text/plain" }));

  const sanitized = sanitizeFormData(form);
  assert.equal(sanitized.get("title"), "my title");

  const file = sanitized.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "report.txt");
});

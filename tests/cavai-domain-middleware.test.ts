import test from "node:test";
import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

function request(url: string, host: string) {
  return new NextRequest(url, {
    headers: new Headers({
      host,
    }),
  });
}

test("production app host /cavai renders as an app route without external redirect", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  try {
    const response = await middleware(
      request(
        "https://app.cavbot.io/cavai?surface=workspace&context=Workspace%20context",
        "app.cavbot.io"
      )
    );

    assert.notEqual(response.status, 301);
    assert.notEqual(response.status, 302);
    assert.notEqual(response.status, 307);
    assert.notEqual(response.status, 308);
    assert.equal(response.headers.get("location"), null);
  } finally {
    Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  }
});

test("production app host /cavai remains public middleware pass-through", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  try {
    const response = await middleware(request("https://app.cavbot.io/cavai", "app.cavbot.io"));

    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(response.headers.get("location"), null);
  } finally {
    Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  }
});

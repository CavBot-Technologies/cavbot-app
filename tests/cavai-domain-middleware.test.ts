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

test("production app host /cavai redirects to the ai.cavbot.io canonical URL", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  try {
    const response = await middleware(
      request(
        "https://app.cavbot.io/cavai?surface=workspace&context=Workspace%20context",
        "app.cavbot.io"
      )
    );

    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "https://ai.cavbot.io/");
  } finally {
    Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  }
});

test("production ai.cavbot.io root rewrites into the CavAi workspace page", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  try {
    const response = await middleware(request("https://ai.cavbot.io/", "ai.cavbot.io"));

    assert.equal(
      response.headers.get("x-middleware-rewrite")?.endsWith(
        "/cavai?surface=workspace&context=Workspace+context"
      ),
      true
    );
    assert.equal(response.headers.get("location"), null);
  } finally {
    Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  }
});

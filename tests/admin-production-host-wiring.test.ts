import assert from "node:assert/strict";
import test from "node:test";

import { assertWriteOrigin } from "@/lib/apiAuth";
import { getAdminAllowedHosts, getAdminBaseUrl, isAdminHost } from "@/lib/admin/config";

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("production HQ host is recognized without an opt-in flag", () => {
  withEnv(
    {
      NODE_ENV: "production",
      ADMIN_ALLOWED_HOSTS: "",
      ADMIN_BASE_URL: "",
      ADMIN_ENABLE_PRODUCTION_HOST: "0",
      ADMIN_PRODUCTION_HOSTS: "",
    },
    () => {
      assert.equal(isAdminHost("admin.cavbot.io"), true);
      assert.equal(getAdminAllowedHosts().includes("admin.cavbot.io"), true);
      assert.equal(getAdminBaseUrl(), "https://admin.cavbot.io");
    },
  );
});

test("admin write origin accepts admin.cavbot.io in production without extra admin env", () => {
  withEnv(
    {
      NODE_ENV: "production",
      CAVBOT_APP_ORIGIN: "https://app.cavbot.io",
      ALLOWED_ORIGINS: "",
      ADMIN_ALLOWED_HOSTS: "",
      ADMIN_BASE_URL: "",
      ADMIN_ENABLE_PRODUCTION_HOST: "0",
      ADMIN_PRODUCTION_HOSTS: "",
    },
    () => {
      const request = new Request("https://admin.cavbot.io/api/admin/session/challenge", {
        method: "POST",
        headers: {
          origin: "https://admin.cavbot.io",
          host: "admin.cavbot.io",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "admin.cavbot.io",
        },
      });

      assert.doesNotThrow(() => assertWriteOrigin(request));
    },
  );
});

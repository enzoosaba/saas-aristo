import test from "node:test";
import assert from "node:assert/strict";
import { allowedRequestOrigins } from "../src/server/origin.ts";

function withEnvironment(values, work) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    work();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production accepts only its configured origin outside Vercel previews", () => {
  withEnvironment(
    {
      APP_ORIGIN: "https://saas-aristo-umber.vercel.app",
      VERCEL: undefined,
      VERCEL_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
    },
    () => {
      const allowed = allowedRequestOrigins("https://attacker.example/api/auth");
      assert.deepEqual([...allowed], ["https://saas-aristo-umber.vercel.app"]);
    },
  );
});

test("Vercel preview accepts its platform-provided deployment and branch origins", () => {
  withEnvironment(
    {
      APP_ORIGIN: "https://saas-aristo-umber.vercel.app",
      VERCEL: "1",
      VERCEL_URL: "saas-aristo-preview-enzosaba1.vercel.app",
      VERCEL_BRANCH_URL: "saas-aristo-git-feat-focus-enzosaba1.vercel.app",
    },
    () => {
      const allowed = allowedRequestOrigins(
        "https://saas-aristo-preview-enzosaba1.vercel.app/api/auth",
      );
      assert.equal(allowed.has("https://saas-aristo-umber.vercel.app"), true);
      assert.equal(
        allowed.has("https://saas-aristo-preview-enzosaba1.vercel.app"),
        true,
      );
      assert.equal(
        allowed.has("https://saas-aristo-git-feat-focus-enzosaba1.vercel.app"),
        true,
      );
      assert.equal(allowed.has("https://attacker.example"), false);
    },
  );
});

test("without configured origins local development remains same-origin", () => {
  withEnvironment(
    {
      APP_ORIGIN: undefined,
      VERCEL: undefined,
      VERCEL_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
    },
    () => {
      assert.deepEqual(
        [...allowedRequestOrigins("http://localhost:3000/api/auth")],
        ["http://localhost:3000"],
      );
    },
  );
});

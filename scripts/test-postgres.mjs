import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "node:child_process";

async function run(url, script, extra = {}, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      TEST_DATABASE_URL: url,
      ...extra,
    },
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  if (code) throw new Error(`Falha em ${script}: ${code}`);
}
// Same as run(), but captures stdout instead of inheriting it — used only
// to read back the connection string provision-app-role.mjs prints with
// --print-url, never for anything that produces test output worth seeing
// live.
function runCaptured(url, script, extra = {}, args = []) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, DATABASE_URL: url, ...extra },
    });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.pipe(process.stderr);
    child.on("error", reject);
    child.on("exit", (code) =>
      code
        ? reject(new Error(`Falha em ${script}: ${code}`))
        : resolve(output.trim()),
    );
  });
}

// Disposable PostgreSQL engine over the real pg wire protocol; no cloud
// credentials. A fresh instance per pass — the e2e suites create fixture
// data with fixed names (e.g. a second organization), which collides on a
// second run against an already-populated database. That's a test-harness
// concern, not something a shared instance should paper over.
async function withDisposablePostgres(work) {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 20,
  });
  await server.start();
  const url = `postgresql://postgres@${server.getServerConn()}/postgres`;
  try {
    await work(url);
  } finally {
    await server.stop();
    await db.close();
  }
}

await withDisposablePostgres(async (url) => {
  await run(url, "scripts/migrate-postgres.mjs");
  await run(url, "scripts/migrate-postgres.mjs");
  await run(url, "scripts/run-e2e.mjs", { TEST_PORT: "3102" });
  console.log(
    "PostgreSQL local (as postgres/owner): migrations, pg driver and browser flows passed.",
  );
});

// Fase 3B part 7: the same full delivery/e2e suite, against its own fresh
// database, with the app configured to prefer APP_DATABASE_URL — this
// proves the env-var switch and the app's own code path don't crash when
// APP_DATABASE_URL is set, and that provision-app-role.mjs's plumbing
// works end to end.
//
// It does NOT prove RLS is actually enforced, and must never be reported
// as if it did — verified empirically (not assumed) that
// @electric-sql/pglite-socket's PGLiteSocketServer does not authenticate
// connections at all: a client can supply a totally nonexistent
// username/password and it's accepted anyway, always as the underlying
// PGlite instance's owner. Every RLS *policy* test in
// tests/postgres.test.mjs is unaffected by this — those use SET ROLE
// inside an already-open, in-process PGlite connection (a real, correctly
// implemented Postgres privilege mechanism), never a second
// password-authenticated connection. But this specific pass — a fresh
// TCP/password-authenticated connection claiming to be aristo_app — is
// silently treated as the owning role underneath, regardless of the
// credential supplied, so it can't catch an RLS regression a genuine
// aristo_app connection would.
//
// The one real bug this exact gap let through: a smoke test against the
// live Supabase database (which does authenticate for real) found that
// tenants_select blocked every fresh registrant from discovering Tenant
// 01's id, breaking every registration outright — this pass here reported
// "safe to cut over" the whole time regardless, because it was never
// actually testing under RLS. Fixed in migration 202609160019; this pass
// stays as a smoke test for the plumbing, not a substitute for testing
// against a real, authenticating Postgres (the live database, or CI's
// postgres job below, which uses a real postgres:17 Docker service).
await withDisposablePostgres(async (url) => {
  await run(url, "scripts/migrate-postgres.mjs");
  const appDatabaseUrl = await runCaptured(
    url,
    "scripts/provision-app-role.mjs",
    {},
    ["--print-url"],
  );
  await run(url, "scripts/run-e2e.mjs", {
    TEST_PORT: "3103",
    APP_DATABASE_URL: appDatabaseUrl,
  });
  console.log(
    "PostgreSQL local (APP_DATABASE_URL plumbing smoke test — does NOT prove RLS enforcement, see comment above): browser flows passed.",
  );
});

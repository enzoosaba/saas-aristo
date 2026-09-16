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

// Fase 3B part 7 (cutover) validation: the same full delivery/e2e suite,
// against its own fresh database, but with the app itself connecting as
// aristo_app (RLS-restricted) instead of the owning role — this is what
// actually proves the cutover is safe, not just that each policy compiles
// in isolation (tests/postgres.test.mjs) or that the app works when RLS is
// a no-op (the pass above). provision-app-role.mjs's --print-url mode
// generates a throwaway password for this disposable database and never
// touches .env.local.
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
    "PostgreSQL local (as aristo_app/RLS-restricted): browser flows passed — safe to cut over.",
  );
});

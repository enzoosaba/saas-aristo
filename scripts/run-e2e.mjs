import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
const port = process.env.TEST_PORT || "3101";
const origin = `http://localhost:${port}`;
const databasePath = resolve(`data/e2e-${Date.now()}.sqlite`);
const testDatabaseUrl = process.env.TEST_DATABASE_URL || "";
if (testDatabaseUrl && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(testDatabaseUrl).hostname))
  throw new Error("Testes aceitam apenas um PostgreSQL local descartável.");
const server = spawn(process.execPath, ["scripts/start.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    APP_ORIGIN: origin,
    DATABASE_PATH: databasePath,
    DATABASE_URL: testDatabaseUrl,
    RESEND_API_KEY: "",
    // Fase 3B part 7: scripts/start.mjs unconditionally loads .env.local
    // (process.loadEnvFile only fills in keys not already present in
    // process.env) — without an explicit value here, a real
    // APP_DATABASE_URL sitting in .env.local (e.g. from
    // pnpm db:provision-app-role) would silently leak into every e2e run
    // and point database.ts's pool() at the real database instead of this
    // disposable one, defeating the whole point of an isolated test.
    // test-postgres.mjs passes its own APP_DATABASE_URL explicitly when it
    // wants the aristo_app pass; every other caller gets "" (falls back to
    // DATABASE_URL, i.e. plain SQLite/e2e or the disposable Postgres).
    APP_DATABASE_URL: process.env.APP_DATABASE_URL || "",
  },
});
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(origin + "/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw Error("Servidor de teste não iniciou");
  for (const script of [
    "artifacts/delivery-e2e.mjs",
    "artifacts/weekly-e2e.mjs",
    "artifacts/responsive-e2e.mjs",
    "artifacts/production-e2e.mjs",
    "artifacts/missions-toggle-e2e.mjs",
    "artifacts/motion-system-e2e.mjs",
    "artifacts/count-stepper-e2e.mjs",
  ]) {
    const child = spawn(process.execPath, [script], {
      stdio: "inherit",
      env: { ...process.env, TEST_BASE_URL: origin, TEST_DATABASE_PATH: databasePath, TEST_DATABASE_URL: testDatabaseUrl },
    });
    const code = await new Promise((resolve) =>
      child.on("exit", (code) => resolve(code ?? 1)),
    );
    if (code) {
      process.exitCode = code;
      break;
    }
  }
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(databasePath + suffix, { force: true });
}

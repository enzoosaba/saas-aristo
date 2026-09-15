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

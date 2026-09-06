import { spawn } from "node:child_process";
import { resolve } from "node:path";
const port = process.env.TEST_PORT || "3101";
const origin = `http://localhost:${port}`;
const server = spawn(process.execPath, ["scripts/start.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    APP_ORIGIN: origin,
    DATABASE_PATH: resolve(`data/e2e-${Date.now()}.sqlite`),
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
  const child = spawn(process.execPath, ["artifacts/production-e2e.mjs"], {
    stdio: "inherit",
    env: { ...process.env, TEST_BASE_URL: origin },
  });
  process.exitCode = await new Promise((resolve) =>
    child.on("exit", (code) => resolve(code || 0)),
  );
} finally {
  server.kill("SIGTERM");
}

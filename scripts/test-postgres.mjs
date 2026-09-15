import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "node:child_process";

// Disposable PostgreSQL engine over the real pg wire protocol; no cloud credentials.
const db = await PGlite.create();
const server = new PGLiteSocketServer({
  db,
  host: "127.0.0.1",
  port: 0,
  maxConnections: 20,
});
await server.start();
const url = `postgresql://postgres@${server.getServerConn()}/postgres`;
async function run(script, extra = {}) {
  const child = spawn(process.execPath, [script], {
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
try {
  await run("scripts/migrate-postgres.mjs");
  await run("scripts/migrate-postgres.mjs");
  await run("scripts/run-e2e.mjs", { TEST_PORT: "3102" });
  console.log(
    "PostgreSQL local: migrations, pg driver and browser flows passed.",
  );
} finally {
  await server.stop();
  await db.close();
}

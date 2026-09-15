import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { postgresConfig } from "../src/server/postgres-config.mjs";

const config = postgresConfig();
const url = new URL(config.connectionString);
const folder = resolve("data/backups");
mkdirSync(folder, { recursive: true });
const file = resolve(folder, `coelho-${Date.now()}.dump`);
const certificate = resolve(folder, `ca-${Date.now()}.pem`);
if (config.ssl?.ca) writeFileSync(certificate, config.ssl.ca, { mode: 0o600 });
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGSSLMODE: config.ssl ? "verify-full" : "disable",
  ...(config.ssl?.ca ? { PGSSLROOTCERT: certificate } : {}),
};
async function run(command, args) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
  if (code !== 0) throw new Error(`${command} falhou.`);
}
try {
  await run("pg_dump", [
    "--format=custom",
    "--schema=coelho",
    "--no-owner",
    "--no-acl",
    "--file",
    file,
  ]);
  await run("pg_restore", ["--list", file]);
  console.log(`Backup PostgreSQL criado e catálogo conferido: ${file}`);
} catch (error) {
  rmSync(file, { force: true });
  console.error(
    "Backup não concluído. Instale pg_dump/pg_restore compatíveis com o servidor e confira a conexão.",
    error.code || error.name,
  );
  process.exitCode = 1;
} finally {
  if (config.ssl?.ca) rmSync(certificate, { force: true });
}

import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { postgresConfig } from "../src/server/postgres-config.mjs";

const pool = new Pool(postgresConfig());
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(2292026)");
  await client.query("CREATE SCHEMA IF NOT EXISTS aristo");
  await client.query("REVOKE ALL ON SCHEMA aristo FROM PUBLIC");
  await client.query(
    "CREATE TABLE IF NOT EXISTS aristo.migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const folder = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(folder))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(new URL(name, folder), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const { rows } = await client.query(
      "SELECT checksum FROM aristo.migrations WHERE name=$1",
      [name],
    );
    if (rows.length) {
      if (rows[0].checksum !== checksum)
        throw new Error(`Migração alterada após aplicação: ${name}`);
      continue;
    }
    await client.query(sql);
    await client.query(
      "INSERT INTO aristo.migrations(name,checksum) VALUES($1,$2)",
      [name, checksum],
    );
    console.log(`Aplicada: ${name}`);
  }
  await client.query("COMMIT");
  console.log("Migrações concluídas.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error(
    "Migração cancelada; nenhuma alteração parcial foi mantida.",
    error.code || error.name,
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

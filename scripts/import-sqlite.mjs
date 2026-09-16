import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { postgresConfig } from "../src/server/postgres-config.mjs";

// Offline cutover: stop writes to the source first. Destination must be empty.
const path = resolve(process.env.DATABASE_PATH || "data/aristo.sqlite");
if (!existsSync(path))
  throw new Error("Banco SQLite de origem não encontrado.");
const backupFolder = resolve(process.env.BACKUP_DIR || "data/backups");
mkdirSync(backupFolder, { recursive: true });
const source = new DatabaseSync(path, { readOnly: true });
const snapshot = resolve(backupFolder, `before-postgres-${Date.now()}.sqlite`);
await backup(source, snapshot);
source.close();
const sqlite = new DatabaseSync(snapshot, { readOnly: true });
const pool = new Pool(postgresConfig());
const client = await pool.connect();
const tables = [
  "users",
  "mentor_students",
  "items",
  "records",
  "plans",
  "questions",
  "study_sessions",
  "demo_batches",
];
// Fase 2A: these five tables now require tenant_id/organization_id in
// Postgres, columns SQLite never had. A SQLite backup predates multi-tenant
// entirely, so — same as every other backfill in this migration — every
// imported row is stamped as belonging to Tenant 01 / Turma Inicial.
const SCOPED_TABLES = new Set([
  "items",
  "records",
  "plans",
  "questions",
  "study_sessions",
]);
try {
  if (sqlite.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("Backup inválido.");
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(2292026)");
  await client.query(
    `LOCK TABLE ${tables.map((t) => `aristo.${t}`).join(",")} IN ACCESS EXCLUSIVE MODE`,
  );
  for (const table of tables) {
    const { rows } = await client.query(
      `SELECT COUNT(*) AS total FROM aristo.${table}`,
    );
    if (Number(rows[0].total))
      throw new Error("Destino não está vazio; importação cancelada.");
  }
  let tenantId, organizationId;
  if (tables.some((t) => SCOPED_TABLES.has(t))) {
    ({
      rows: [{ id: tenantId }],
    } = await client.query(
      "SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'",
    ));
    ({
      rows: [{ id: organizationId }],
    } = await client.query(
      "SELECT id FROM aristo.organizations WHERE tenant_id=$1 AND name='Turma Inicial'",
      [tenantId],
    ));
  }
  for (const table of tables) {
    const rows = sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    for (const row of rows) {
      const keys = Object.keys(row);
      const values = Object.values(row);
      if (SCOPED_TABLES.has(table)) {
        keys.push("tenant_id", "organization_id");
        values.push(tenantId, organizationId);
      }
      await client.query(
        `INSERT INTO aristo.${table} (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        values,
      );
    }
    const check = await client.query(
      `SELECT COUNT(*) AS total FROM aristo.${table}`,
    );
    if (Number(check.rows[0].total) !== rows.length)
      throw new Error(`Contagem divergente: ${table}`);
    console.log(`${table}: ${rows.length} registros conferidos`);
  }
  await client.query("COMMIT");
  console.log(
    "Importação concluída. Contas e senhas preservadas; entre novamente para criar uma sessão.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  console.error(
    "Importação cancelada e revertida.",
    error.code || error.message,
  );
  process.exitCode = 1;
} finally {
  sqlite.close();
  client.release();
  await pool.end();
}

import { Pool } from "pg";
import { postgresConfig } from "../src/server/postgres-config.mjs";
const pool = new Pool(postgresConfig());
try {
  for (const table of [
    "users",
    "sessions",
    "items",
    "records",
    "plans",
    "questions",
    "study_sessions",
    "mentor_students",
    "password_resets",
  ]) {
    await pool.query(`SELECT 1 FROM coelho.${table} LIMIT 1`);
  }
  const { rows } = await pool.query(
    "SELECT name FROM coelho.migrations ORDER BY name",
  );
  console.log(
    JSON.stringify({ status: "ok", migrations: rows.map((r) => r.name) }),
  );
} catch (error) {
  console.error(
    "Banco indisponível ou migrações incompletas.",
    error.code || error.name,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { Pool } from "pg";
import { postgresConfig, postgresSql } from "../src/server/postgres-config.mjs";
const email = process.argv[2];
if (!email) throw Error("Informe o e-mail da conta a promover para mentor.");
const pool = process.env.DATABASE_URL ? new Pool(postgresConfig()) : null;
const db = pool
  ? null
  : new DatabaseSync(
      resolve(process.env.DATABASE_PATH || "data/aristo.sqlite"),
    );
try {
  const query = async (sql, values) =>
    pool
      ? (await pool.query(postgresSql(sql), values)).rows
      : db.prepare(sql).all(...values);
  const [user] = await query("SELECT id,name,role FROM users WHERE email=?", [
    email.trim().toLowerCase(),
  ]);
  if (!user) throw Error("Conta nao encontrada.");
  await query("UPDATE users SET role='mentor' WHERE id=?", [user.id]);
  console.log("Papel de mentor configurado.");
} finally {
  db?.close();
  await pool?.end();
}

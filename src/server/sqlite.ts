import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const globalDb = globalThis as unknown as { aristoDb?: DatabaseSync };
export const recordsValueConstraintMigration = `BEGIN IMMEDIATE;
  CREATE TABLE records_with_value_check (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    date TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    target INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(user_id,item_id,date),
    CONSTRAINT records_value_within_target
      CHECK(value >= 0 AND target > 0 AND value <= target)
  );
  INSERT INTO records_with_value_check(user_id,item_id,date,value,done,target,version)
    SELECT user_id,item_id,date,value,done,target,version FROM records;
  DROP TABLE records;
  ALTER TABLE records_with_value_check RENAME TO records;
  PRAGMA user_version=5;
  COMMIT;`;

export function db() {
  if (globalDb.aristoDb) return globalDb.aristoDb;
  const path = resolve(
    /* turbopackIgnore: true */ process.env.DATABASE_PATH ||
      "data/aristo.sqlite",
  );
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','mentor')), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mentor_students (mentor_id TEXT REFERENCES users(id), student_id TEXT REFERENCES users(id), PRIMARY KEY(mentor_id,student_id));
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS items_user ON items(user_id,archived);
    CREATE TABLE IF NOT EXISTS records (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id), date TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, target INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id,item_id,date));
    CREATE TABLE IF NOT EXISTS plans (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id,date));
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS questions_user ON questions(user_id);
    CREATE TABLE IF NOT EXISTS study_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS study_sessions_user ON study_sessions(user_id);
    CREATE TABLE IF NOT EXISTS demo_batches (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS password_resets (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);
  `);
  const { user_version } = connection.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (user_version < 4) {
    connection.exec(
      "ALTER TABLE users ADD COLUMN avatar TEXT; PRAGMA user_version=4;",
    );
  }
  if (user_version < 5) {
    try {
      connection.exec(recordsValueConstraintMigration);
    } catch (error) {
      if (connection.isTransaction) connection.exec("ROLLBACK");
      throw error;
    }
  }
  globalDb.aristoDb = connection;
  return connection;
}
export function transaction<T>(work: () => T): T {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

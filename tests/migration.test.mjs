import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("SQLite import preserves accounts, backs up source and refuses an occupied destination", async () => {
  const folder = mkdtempSync(join(tmpdir(), "aristo-migration-"));
  process.env.DATABASE_PATH = join(folder, "source.sqlite");
  const { db: sqliteDb } = await import("../src/server/sqlite.ts");
  const source = sqliteDb();
  source
    .prepare(
      "INSERT INTO users(id,name,email,password,created_at) VALUES(?,?,?,?,?)",
    )
    .run("fixture", "Aluno", "fixture@example.test", "preserved-hash", 123);
  source
    .prepare("INSERT INTO items(id,user_id,data) VALUES(?,?,?)")
    .run("item", "fixture", '{"title":"Estudar"}');
  source
    .prepare(
      "INSERT INTO records(user_id,item_id,date,value,done,target) VALUES(?,?,?,?,?,?)",
    )
    .run("fixture", "item", "2026-09-15", 1, 1, 1);
  const pg = await PGlite.create();
  const server = new PGLiteSocketServer({
    db: pg,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 5,
  });
  await server.start();
  const url = `postgresql://postgres@${server.getServerConn()}/postgres`;
  async function run(script) {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        DATABASE_URL: url,
        BACKUP_DIR: join(folder, "backups"),
      },
      stdio: "pipe",
    });
    child.stdout.resume();
    child.stderr.resume();
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
  }
  try {
    assert.equal(await run("scripts/migrate-postgres.mjs"), 0);
    assert.equal(await run("scripts/migrate-postgres.mjs"), 0);
    assert.equal(await run("scripts/import-sqlite.mjs"), 0);
    const { rows } = await pg.query(
      "SELECT password FROM aristo.users WHERE id='fixture'",
    );
    assert.equal(rows[0].password, "preserved-hash");
    assert.equal(
      (await pg.query("SELECT done FROM aristo.records")).rows[0].done,
      1,
    );
    assert.ok(
      readdirSync(join(folder, "backups")).some((f) => f.endsWith(".sqlite")),
    );
    assert.equal(await run("scripts/import-sqlite.mjs"), 1);
    assert.equal(
      (await pg.query("SELECT count(*) AS total FROM aristo.users")).rows[0]
        .total,
      1,
    );
    assert.equal(
      source.prepare("SELECT COUNT(*) AS total FROM users").get().total,
      1,
    );
  } finally {
    source.close();
    await server.stop();
    await pg.close();
    // Only this test's mkdtemp directory is removed.
    assert.ok(folder.startsWith(join(tmpdir(), "aristo-migration-")));
    rmSync(folder, { recursive: true, force: true });
  }
});

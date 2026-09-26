import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { recordsValueConstraintMigration } from "../src/server/sqlite.ts";

const migration = "202609250027_records_value_within_target.sql";

async function postgresBeforeConstraint() {
  const db = new PGlite();
  for (const file of readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql") && file < migration)
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const scope = (
    await db.query(
      `SELECT t.id AS tenant_id,o.id AS organization_id
       FROM aristo.tenants t
       JOIN aristo.organizations o ON o.tenant_id=t.id
       WHERE t.slug='mentoria-coelho' AND o.name='Turma Inicial'`,
    )
  ).rows[0];
  await db.query(
    `INSERT INTO aristo.users(id,name,email,password,role,created_at)
       VALUES('constraint-student','Student','constraint@example.test','unused','student',0)`,
  );
  await db.query(
    `INSERT INTO aristo.items(id,user_id,data,tenant_id,organization_id)
       VALUES('constraint-item','constraint-student','{}',$1,$2)`,
    [scope.tenant_id, scope.organization_id],
  );
  return { db, scope };
}

function postgresInsert(db, scope, date, value, target) {
  return db.query(
    `INSERT INTO aristo.records
       (user_id,item_id,date,value,done,target,tenant_id,organization_id)
     VALUES('constraint-student','constraint-item',$1,$2,0,$3,$4,$5)`,
    [date, value, target, scope.tenant_id, scope.organization_id],
  );
}

test("PostgreSQL rejects every invalid value/target combination after the migration", async () => {
  const { db, scope } = await postgresBeforeConstraint();
  try {
    // The original PostgreSQL schema already protected these two conditions.
    await assert.rejects(postgresInsert(db, scope, "2026-01-01", -1, 1), {
      code: "23514",
    });
    await assert.rejects(postgresInsert(db, scope, "2026-01-02", 0, 0), {
      code: "23514",
    });

    // This is the actual pre-migration gap: value > target was accepted.
    await postgresInsert(db, scope, "2026-01-03", 2, 1);
    assert.equal(
      (
        await db.query(
          "SELECT value FROM aristo.records WHERE date='2026-01-03'",
        )
      ).rows[0].value,
      2,
    );
    await db.query("DELETE FROM aristo.records WHERE date='2026-01-03'");

    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    for (const [date, value, target] of [
      ["2026-01-04", -1, 1],
      ["2026-01-05", 0, 0],
      ["2026-01-06", 2, 1],
    ])
      await assert.rejects(postgresInsert(db, scope, date, value, target), {
        code: "23514",
      });

    await postgresInsert(db, scope, "2026-01-07", 1, 1);
    await assert.rejects(
      db.query(
        `UPDATE aristo.records SET value=2
         WHERE user_id='constraint-student' AND item_id='constraint-item' AND date='2026-01-07'`,
      ),
      { code: "23514" },
    );
  } finally {
    await db.close();
  }
});

test("SQLite migration replaces permissive records schema with an enforced CHECK", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE items(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE records(
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES items(id), date TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
        target INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(user_id,item_id,date)
      );
      INSERT INTO users(id) VALUES('student');
      INSERT INTO items(id,user_id) VALUES('item','student');
      INSERT INTO records(user_id,item_id,date,value,target) VALUES
        ('student','item','2026-01-01',-1,1),
        ('student','item','2026-01-02',0,0),
        ('student','item','2026-01-03',2,1);
      DELETE FROM records;
      PRAGMA user_version=4;`);
    sqlite.exec(recordsValueConstraintMigration);
    for (const [date, value, target] of [
      ["2026-01-04", -1, 1],
      ["2026-01-05", 0, 0],
      ["2026-01-06", 2, 1],
    ])
      assert.throws(
        () =>
          sqlite.exec(
            `INSERT INTO records(user_id,item_id,date,value,target) VALUES('student','item','${date}',${value},${target})`,
          ),
        /CHECK constraint failed/,
      );
    sqlite.exec(
      "INSERT INTO records(user_id,item_id,date,value,target) VALUES('student','item','2026-01-07',1,1)",
    );
    assert.throws(
      () => sqlite.exec("UPDATE records SET value=2"),
      /CHECK constraint failed/,
    );
  } finally {
    sqlite.close();
  }
});

test("SQLite migration refuses dirty existing data without changing it", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE items(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE records(
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES items(id), date TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0,
        target INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(user_id,item_id,date)
      );
      INSERT INTO users(id) VALUES('student');
      INSERT INTO items(id,user_id) VALUES('item','student');
      INSERT INTO records(user_id,item_id,date,value,target)
        VALUES('student','item','2026-01-01',2,1);`);
    assert.throws(
      () => sqlite.exec(recordsValueConstraintMigration),
      /CHECK constraint failed/,
    );
    if (sqlite.isTransaction) sqlite.exec("ROLLBACK");
    assert.equal(sqlite.prepare("SELECT value FROM records").get().value, 2);
  } finally {
    sqlite.close();
  }
});

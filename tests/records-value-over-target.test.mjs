import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import {
  recordsValueConstraintMigration,
  recordsValueNoUpperBoundMigration,
} from "../src/server/sqlite.ts";

test("PostgreSQL preserves values above target and the mission ledger accepts them", async () => {
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const scope = (
      await db.query(
        `SELECT t.id AS tenant_id,o.id AS organization_id
         FROM aristo.tenants t JOIN aristo.organizations o ON o.tenant_id=t.id
         WHERE t.slug='mentoria-coelho' AND o.name='Turma Inicial'`,
      )
    ).rows[0];
    await db.exec(`GRANT aristo_app TO postgres;
      INSERT INTO aristo.users(id,name,email,password,role,created_at)
        VALUES('over-target-student','Student','over-target@example.test','unused','student',0);
      INSERT INTO aristo.tenant_members(tenant_id,user_id,role)
        VALUES('${scope.tenant_id}','over-target-student','STUDENT');
      INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role)
        VALUES('${scope.tenant_id}','${scope.organization_id}','over-target-student','STUDENT');
      INSERT INTO aristo.items(id,user_id,data,tenant_id,organization_id)
        VALUES('over-target-item','over-target-student','{}','${scope.tenant_id}','${scope.organization_id}');`);

    await db.query(
      `INSERT INTO aristo.records
         (user_id,item_id,date,value,done,target,tenant_id,organization_id)
       VALUES('over-target-student','over-target-item','2026-09-27',47,1,30,$1,$2)`,
      [scope.tenant_id, scope.organization_id],
    );
    assert.deepEqual(
      (
        await db.query(
          `SELECT value,target,done FROM aristo.records
           WHERE user_id='over-target-student' AND item_id='over-target-item'`,
        )
      ).rows[0],
      { value: 47, target: 30, done: 1 },
    );
    await assert.rejects(
      db.query(
        `UPDATE aristo.records SET value=-1
         WHERE user_id='over-target-student' AND item_id='over-target-item'`,
      ),
      { code: "23514" },
    );

    await db.exec("BEGIN; SET LOCAL ROLE aristo_app");
    await db.query("SELECT set_config('app.user_id',$1,true)", [
      "over-target-student",
    ]);
    await db.query(
      "SELECT aristo.record_mission_completion($1,$2,$3)",
      ["over-target-student", "over-target-item", "2026-09-27"],
    );
    await db.exec("COMMIT");
    assert.equal(
      Number(
        (
          await db.query(
            `SELECT count(*) AS total FROM aristo.mission_completions
             WHERE user_id='over-target-student' AND item_id='over-target-item'`,
          )
        ).rows[0].total,
      ),
      1,
    );
  } finally {
    await db.close();
  }
});

test("SQLite upgrade removes only the upper bound", () => {
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
      PRAGMA user_version=4;`);
    sqlite.exec(recordsValueConstraintMigration);
    assert.throws(
      () =>
        sqlite.exec(
          "INSERT INTO records(user_id,item_id,date,value,target) VALUES('student','item','2026-09-27',47,30)",
        ),
      /CHECK constraint failed/,
    );

    sqlite.exec(recordsValueNoUpperBoundMigration);
    sqlite.exec(
      "INSERT INTO records(user_id,item_id,date,value,target) VALUES('student','item','2026-09-27',47,30)",
    );
    assert.equal(sqlite.prepare("SELECT value FROM records").get().value, 47);
    assert.throws(
      () => sqlite.exec("UPDATE records SET value=-1"),
      /CHECK constraint failed/,
    );
    assert.equal(
      sqlite.prepare("PRAGMA user_version").get().user_version,
      6,
    );
  } finally {
    sqlite.close();
  }
});

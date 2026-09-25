import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

async function fixture() {
  const db = new PGlite();
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const scope = (
    await db.query(
      `SELECT t.id AS tenant_id,o.id AS organization_id FROM aristo.tenants t JOIN aristo.organizations o ON o.tenant_id=t.id WHERE t.slug='mentoria-coelho' AND o.name='Turma Inicial'`,
    )
  ).rows[0];
  await db.exec(`GRANT aristo_app TO postgres;
    INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
      ('badge-student','Student','badge-student@example.test','unused','student',0),
      ('badge-other','Other','badge-other@example.test','unused','student',0),
      ('badge-mentor','Mentor','badge-mentor@example.test','unused','mentor',0),
      ('badge-admin','Admin','badge-admin@example.test','unused','student',0);
    INSERT INTO aristo.platform_admins(user_id) VALUES ('badge-admin');
    INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES
      ('${scope.tenant_id}','badge-student','STUDENT'),('${scope.tenant_id}','badge-other','STUDENT'),('${scope.tenant_id}','badge-mentor','MENTOR');
    INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES
      ('${scope.tenant_id}','${scope.organization_id}','badge-student','STUDENT'),
      ('${scope.tenant_id}','${scope.organization_id}','badge-other','STUDENT'),
      ('${scope.tenant_id}','${scope.organization_id}','badge-mentor','MENTOR');
    INSERT INTO aristo.mentor_students(mentor_id,student_id) VALUES ('badge-mentor','badge-student');
    INSERT INTO aristo.items(id,user_id,data,tenant_id,organization_id) VALUES ('badge-item','badge-student','{}','${scope.tenant_id}','${scope.organization_id}');`);
  const asApp = async (actor, sql, params = []) => {
    await db.exec("BEGIN; SET LOCAL ROLE aristo_app");
    try {
      await db.query("SELECT set_config('app.user_id',$1,true)", [actor ?? ""]);
      const result = await db.query(sql, params);
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  };
  return { db, asApp, scope };
}

test("badge catalog seeds 20 stable badges and enforces slot and threshold relationships", async () => {
  const { db } = await fixture();
  try {
    const rows = (
      await db.query(
        "SELECT id,category,threshold_value FROM aristo.badges ORDER BY id",
      )
    ).rows;
    assert.equal(rows.length, 20);
    assert.equal(
      rows.find((b) => b.id === "division_aprendiz").threshold_value,
      0,
    );
    assert.equal(rows.filter((b) => b.category === "division").length, 4);
    assert.equal(rows.filter((b) => b.category === "track").length, 16);
    await assert.rejects(
      db.query(
        `INSERT INTO aristo.badges(id,category,tier,name,threshold_type,threshold_value) VALUES('duplicate','division',1,'Duplicate','xp',0)`,
      ),
      { code: "23505" },
    );
    await assert.rejects(
      db.query(
        `INSERT INTO aristo.badges(id,category,tier,name,threshold_type,threshold_value) VALUES('wrong','division',2,'Wrong','focus_minutes',1)`,
      ),
      { code: "23514" },
    );
  } finally {
    await db.close();
  }
});

test("direct unlock writes are denied to every application actor", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    for (const actor of ["badge-student", "badge-mentor", "badge-admin", null])
      await assert.rejects(
        asApp(
          actor,
          `INSERT INTO aristo.achievement_unlocks(user_id,badge_id,tenant_id,organization_id) VALUES('badge-student','division_aprendiz',$1,$2)`,
          [scope.tenant_id, scope.organization_id],
        ),
        { code: "42501" },
      );
    const grants = (
      await db.query(
        `SELECT p,has_table_privilege('aristo_app','aristo.achievement_unlocks',p) AS allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`,
      )
    ).rows;
    assert.deepEqual(grants, [
      { p: "SELECT", allowed: true },
      { p: "INSERT", allowed: false },
      { p: "UPDATE", allowed: false },
      { p: "DELETE", allowed: false },
      { p: "TRUNCATE", allowed: false },
    ]);
  } finally {
    await db.close();
  }
});

test("division synchronization derives XP, advances tiers, and is idempotent", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    await asApp(
      "badge-student",
      "SELECT aristo.sync_division_achievements($1)",
      ["badge-student"],
    );
    assert.deepEqual(
      (
        await asApp(
          "badge-student",
          "SELECT badge_id FROM aristo.achievement_unlocks ORDER BY badge_id",
        )
      ).rows,
      [{ badge_id: "division_aprendiz" }],
    );
    await db.query(
      `INSERT INTO aristo.records(user_id,item_id,date,value,done,target,tenant_id,organization_id) SELECT 'badge-student','badge-item',(date '2026-01-01' + n)::text,1,1,1,$1,$2 FROM generate_series(0,149) n`,
      [scope.tenant_id, scope.organization_id],
    );
    await asApp(
      "badge-student",
      "SELECT aristo.sync_division_achievements($1)",
      ["badge-student"],
    );
    await asApp(
      "badge-student",
      "SELECT aristo.sync_division_achievements($1)",
      ["badge-student"],
    );
    assert.deepEqual(
      (
        await asApp(
          "badge-student",
          "SELECT badge_id FROM aristo.achievement_unlocks ORDER BY badge_id",
        )
      ).rows,
      [
        { badge_id: "division_aprendiz" },
        { badge_id: "division_dedicado" },
        { badge_id: "division_estrategista" },
      ],
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) AS total FROM aristo.achievement_unlocks WHERE user_id='badge-student'",
        )
      ).rows[0].total,
      3,
    );
    await assert.rejects(
      asApp("badge-other", "SELECT aristo.sync_division_achievements($1)", [
        "badge-student",
      ]),
      { code: "42501" },
    );
  } finally {
    await db.close();
  }
});

test("unlock SELECT isolates students and permits only a linked mentor", async () => {
  const { db, asApp } = await fixture();
  try {
    await asApp(
      "badge-student",
      "SELECT aristo.sync_division_achievements($1)",
      ["badge-student"],
    );
    assert.equal(
      (await asApp("badge-student", "SELECT * FROM aristo.achievement_unlocks"))
        .rows.length,
      1,
    );
    assert.equal(
      (await asApp("badge-other", "SELECT * FROM aristo.achievement_unlocks"))
        .rows.length,
      0,
    );
    assert.equal(
      (await asApp("badge-mentor", "SELECT * FROM aristo.achievement_unlocks"))
        .rows.length,
      1,
    );
    await db.exec(
      "DELETE FROM aristo.mentor_students WHERE mentor_id='badge-mentor' AND student_id='badge-student'",
    );
    assert.equal(
      (await asApp("badge-mentor", "SELECT * FROM aristo.achievement_unlocks"))
        .rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

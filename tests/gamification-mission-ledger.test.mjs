import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = "202609250800_gamification_mission_ledger.sql";

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
      ('ledger-student','Student','ledger-student@example.test','unused','student',0),
      ('ledger-other','Other','ledger-other@example.test','unused','student',0),
      ('ledger-mentor','Mentor','ledger-mentor@example.test','unused','mentor',0),
      ('ledger-unlinked-mentor','Unlinked Mentor','ledger-unlinked-mentor@example.test','unused','mentor',0),
      ('ledger-admin','Admin','ledger-admin@example.test','unused','student',0);
    INSERT INTO aristo.platform_admins(user_id) VALUES ('ledger-admin');
    INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES
      ('${scope.tenant_id}','ledger-student','STUDENT'),('${scope.tenant_id}','ledger-other','STUDENT'),
      ('${scope.tenant_id}','ledger-mentor','MENTOR'),('${scope.tenant_id}','ledger-unlinked-mentor','MENTOR');
    INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES
      ('${scope.tenant_id}','${scope.organization_id}','ledger-student','STUDENT'),
      ('${scope.tenant_id}','${scope.organization_id}','ledger-other','STUDENT'),
      ('${scope.tenant_id}','${scope.organization_id}','ledger-mentor','MENTOR'),
      ('${scope.tenant_id}','${scope.organization_id}','ledger-unlinked-mentor','MENTOR');
    INSERT INTO aristo.mentor_students(mentor_id,student_id) VALUES ('ledger-mentor','ledger-student');
    INSERT INTO aristo.items(id,user_id,data,tenant_id,organization_id)
      VALUES ('ledger-item','ledger-student','{}','${scope.tenant_id}','${scope.organization_id}');`);
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

async function addCompletedRecord(db, scope, date) {
  await db.query(
    `INSERT INTO aristo.records
       (user_id,item_id,date,value,done,target,tenant_id,organization_id)
     VALUES('ledger-student','ledger-item',$1,1,1,1,$2,$3)`,
    [date, scope.tenant_id, scope.organization_id],
  );
}

test("migration backfills only records that are genuinely complete", async () => {
  const db = new PGlite();
  try {
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
         VALUES('backfill-student','Student','backfill@example.test','unused','student',0)`,
    );
    await db.query(
      `INSERT INTO aristo.items(id,user_id,data,tenant_id,organization_id)
         VALUES('complete-item','backfill-student','{}',$1,$2),
               ('incomplete-item','backfill-student','{}',$1,$2)`,
      [scope.tenant_id, scope.organization_id],
    );
    await db.query(
      `INSERT INTO aristo.records
         (user_id,item_id,date,value,done,target,tenant_id,organization_id)
       VALUES('backfill-student','complete-item','2026-01-01',1,1,1,$1,$2),
             ('backfill-student','incomplete-item','2026-01-02',0,0,1,$1,$2)`,
      [scope.tenant_id, scope.organization_id],
    );

    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    assert.deepEqual(
      (
        await db.query(
          "SELECT item_id,date FROM aristo.mission_completions ORDER BY item_id",
        )
      ).rows,
      [{ item_id: "complete-item", date: "2026-01-01" }],
    );
  } finally {
    await db.close();
  }
});

test("badges gained a non-blank mentor message for all 20 rows", async () => {
  const { db } = await fixture();
  try {
    const rows = (await db.query("SELECT id,message FROM aristo.badges")).rows;
    assert.equal(rows.length, 20);
    assert.ok(rows.every((b) => b.message && b.message.trim().length > 0));
    await assert.rejects(
      db.query(
        "UPDATE aristo.badges SET message='' WHERE id='division_aprendiz'",
      ),
      { code: "23514" },
    );
    await assert.rejects(
      db.query(
        "UPDATE aristo.badges SET message=NULL WHERE id='division_aprendiz'",
      ),
      { code: "23502" },
    );
  } finally {
    await db.close();
  }
});

test("direct writes to mission_completions are denied to every application actor", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    for (const actor of [
      "ledger-student",
      "ledger-mentor",
      "ledger-admin",
      null,
    ])
      await assert.rejects(
        asApp(
          actor,
          `INSERT INTO aristo.mission_completions(user_id,item_id,date,tenant_id,organization_id) VALUES('ledger-student','item-1','2026-01-01',$1,$2)`,
          [scope.tenant_id, scope.organization_id],
        ),
        { code: "42501" },
      );
    const grants = (
      await db.query(
        `SELECT p,has_table_privilege('aristo_app','aristo.mission_completions',p) AS allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`,
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

test("record_mission_completion is self-only and cannot be called for another user", async () => {
  const { asApp } = await fixture();
  await assert.rejects(
    asApp("ledger-other", "SELECT aristo.record_mission_completion($1,$2,$3)", [
      "ledger-student",
      "item-1",
      "2026-01-01",
    ]),
    { code: "42501" },
  );
  await assert.rejects(
    asApp(null, "SELECT aristo.record_mission_completion($1,$2,$3)", [
      "ledger-student",
      "item-1",
      "2026-01-01",
    ]),
    { code: "42501" },
  );
});

test("record_mission_completion rejects missing and incomplete records", async () => {
  const { db, asApp, scope } = await fixture();
  await assert.rejects(
    asApp(
      "ledger-student",
      "SELECT aristo.record_mission_completion($1,$2,$3)",
      ["ledger-student", "forged-item", "2026-01-01"],
    ),
    { code: "22023" },
  );
  await db.query(
    `INSERT INTO aristo.records
       (user_id,item_id,date,value,done,target,tenant_id,organization_id)
     VALUES('ledger-student','ledger-item','2026-01-02',0,0,1,$1,$2)`,
    [scope.tenant_id, scope.organization_id],
  );
  await assert.rejects(
    asApp(
      "ledger-student",
      "SELECT aristo.record_mission_completion($1,$2,$3)",
      ["ledger-student", "ledger-item", "2026-01-02"],
    ),
    { code: "22023" },
  );
});

test("repeating the same item/date is a no-op: unchecking and rechecking cannot inflate the count", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    await addCompletedRecord(db, scope, "2026-01-01");
    for (let i = 0; i < 5; i++)
      await asApp(
        "ledger-student",
        "SELECT aristo.record_mission_completion($1,$2,$3)",
        ["ledger-student", "ledger-item", "2026-01-01"],
      );
    const rows = (
      await asApp(
        "ledger-student",
        "SELECT item_id,date FROM aristo.mission_completions",
      )
    ).rows;
    assert.deepEqual(rows, [{ item_id: "ledger-item", date: "2026-01-01" }]);
  } finally {
    await db.close();
  }
});

test("cumpridor_missoes badges unlock at their thresholds and stay unlocked, idempotently", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    for (let day = 0; day < 50; day++) {
      const date = new Date(Date.UTC(2026, 0, day + 1))
        .toISOString()
        .slice(0, 10);
      await addCompletedRecord(db, scope, date);
      await asApp(
        "ledger-student",
        "SELECT aristo.record_mission_completion($1,$2,$3)",
        ["ledger-student", "ledger-item", date],
      );
      if (day === 14)
        assert.deepEqual(
          (
            await asApp(
              "ledger-student",
              "SELECT badge_id FROM aristo.achievement_unlocks WHERE badge_id LIKE 'track_cumpridor_missoes%' ORDER BY badge_id",
            )
          ).rows,
          [{ badge_id: "track_cumpridor_missoes_1" }],
        );
    }
    // Re-run synchronization redundantly to prove it stays idempotent.
    await asApp("ledger-student", "SELECT aristo.sync_track_achievements($1)", [
      "ledger-student",
    ]);
    await asApp("ledger-student", "SELECT aristo.sync_track_achievements($1)", [
      "ledger-student",
    ]);
    assert.deepEqual(
      (
        await asApp(
          "ledger-student",
          "SELECT badge_id FROM aristo.achievement_unlocks WHERE badge_id LIKE 'track_cumpridor_missoes%' ORDER BY badge_id",
        )
      ).rows,
      [
        { badge_id: "track_cumpridor_missoes_1" },
        { badge_id: "track_cumpridor_missoes_2" },
      ],
    );
    await assert.rejects(
      asApp("ledger-other", "SELECT aristo.sync_track_achievements($1)", [
        "ledger-student",
      ]),
      { code: "42501" },
    );
  } finally {
    await db.close();
  }
});

test("mission_completions raw SELECT is self-only, including for a linked mentor", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    await addCompletedRecord(db, scope, "2026-01-01");
    await asApp(
      "ledger-student",
      "SELECT aristo.record_mission_completion($1,$2,$3)",
      ["ledger-student", "ledger-item", "2026-01-01"],
    );
    assert.equal(
      (
        await asApp(
          "ledger-student",
          "SELECT * FROM aristo.mission_completions",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await asApp("ledger-other", "SELECT * FROM aristo.mission_completions"))
        .rows.length,
      0,
    );
    assert.equal(
      (await asApp("ledger-mentor", "SELECT * FROM aristo.mission_completions"))
        .rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("mentor mission summary returns only a linked student's aggregate", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    await addCompletedRecord(db, scope, "2026-01-01");
    await asApp(
      "ledger-student",
      "SELECT aristo.record_mission_completion($1,$2,$3)",
      ["ledger-student", "ledger-item", "2026-01-01"],
    );
    assert.deepEqual(
      (
        await asApp(
          "ledger-mentor",
          "SELECT * FROM aristo.mentor_student_mission_summary($1)",
          ["ledger-student"],
        )
      ).rows,
      [{ missions_completed: 1 }],
    );
    for (const actor of ["ledger-unlinked-mentor", null])
      await assert.rejects(
        asApp(
          actor,
          "SELECT * FROM aristo.mentor_student_mission_summary($1)",
          ["ledger-student"],
        ),
        { code: "42501" },
      );
    await db.exec(
      "DELETE FROM aristo.mentor_students WHERE mentor_id='ledger-mentor' AND student_id='ledger-student'",
    );
    await assert.rejects(
      asApp(
        "ledger-mentor",
        "SELECT * FROM aristo.mentor_student_mission_summary($1)",
        ["ledger-student"],
      ),
      { code: "42501" },
    );
  } finally {
    await db.close();
  }
});

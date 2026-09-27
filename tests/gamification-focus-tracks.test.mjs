import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
let scope;

async function asApp(actor, sql, params = []) {
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
}

async function addSession({ counts = true, seconds = null } = {}) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO aristo.focus_sessions
       (id,user_id,tenant_id,organization_id,status,started_at,ended_at,
        paused_seconds_total,net_seconds,counts_toward_maratonista)
     VALUES($1,'focus-track-student',$2,$3,'ENDED',clock_timestamp()-interval '5 minutes',
       clock_timestamp(),0,240,$4)`,
    [id, scope.tenant_id, scope.organization_id, counts],
  );
  if (seconds !== null) {
    await db.query(
      `INSERT INTO aristo.focus_session_daily_credit
         (session_id,local_date,user_id,tenant_id,organization_id,credited_focus_seconds)
       VALUES($1,current_date,'focus-track-student',$2,$3,$4)`,
      [id, scope.tenant_id, scope.organization_id, seconds],
    );
  }
  return id;
}

async function unlocked(track) {
  return (
    await db.query(
      `SELECT u.badge_id FROM aristo.achievement_unlocks u
       JOIN aristo.badges b ON b.id=u.badge_id
       WHERE u.user_id='focus-track-student' AND b.track=$1
       ORDER BY b.tier`,
      [track],
    )
  ).rows.map((row) => row.badge_id);
}

test.before(async () => {
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  scope = (
    await db.query(
      `SELECT t.id AS tenant_id,o.id AS organization_id
       FROM aristo.tenants t JOIN aristo.organizations o ON o.tenant_id=t.id
       WHERE t.slug='mentoria-coelho' AND o.name='Turma Inicial'`,
    )
  ).rows[0];
  await db.exec(`GRANT aristo_app TO postgres;
    INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
      ('focus-track-student','Student','focus-track-student@example.test','unused','student',0),
      ('focus-track-other','Other','focus-track-other@example.test','unused','student',0);
    INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES
      ('${scope.tenant_id}','focus-track-student','STUDENT'),
      ('${scope.tenant_id}','focus-track-other','STUDENT');
    INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES
      ('${scope.tenant_id}','${scope.organization_id}','focus-track-student','STUDENT'),
      ('${scope.tenant_id}','${scope.organization_id}','focus-track-other','STUDENT');`);
});

after(async () => db.close());

test("ineligible sessions contribute to neither focus track", async () => {
  await addSession({ counts: false, seconds: 600001 });
  await asApp(
    "focus-track-student",
    "SELECT aristo.sync_track_achievements($1)",
    ["focus-track-student"],
  );
  assert.deepEqual(await unlocked("maratonista"), []);
  assert.deepEqual(await unlocked("senhor_do_tempo"), []);
});

test("Maratonista unlocks exactly at the eligible-session threshold", async () => {
  for (let index = 0; index < 9; index += 1) await addSession();
  await asApp(
    "focus-track-student",
    "SELECT aristo.sync_track_achievements($1)",
    ["focus-track-student"],
  );
  assert.deepEqual(await unlocked("maratonista"), []);

  await addSession();
  await asApp(
    "focus-track-student",
    "SELECT aristo.sync_track_achievements($1)",
    ["focus-track-student"],
  );
  assert.deepEqual(await unlocked("maratonista"), ["track_maratonista_1"]);
});

test("Senhor do Tempo unlocks exactly at 300 credited minutes", async () => {
  await addSession({ seconds: 17999 });
  await asApp(
    "focus-track-student",
    "SELECT aristo.sync_track_achievements($1)",
    ["focus-track-student"],
  );
  assert.deepEqual(await unlocked("senhor_do_tempo"), []);

  await addSession({ seconds: 1 });
  await asApp(
    "focus-track-student",
    "SELECT aristo.sync_track_achievements($1)",
    ["focus-track-student"],
  );
  assert.deepEqual(await unlocked("senhor_do_tempo"), [
    "track_senhor_do_tempo_1",
  ]);
});

test("focus track synchronization is idempotent and remains self-only", async () => {
  await asApp(
    "focus-track-student",
    "SELECT aristo.sync_track_achievements($1)",
    ["focus-track-student"],
  );
  await asApp(
    "focus-track-student",
    "SELECT aristo.sync_track_achievements($1)",
    ["focus-track-student"],
  );
  assert.equal(
    Number(
      (
        await db.query(
          `SELECT count(*) AS total FROM aristo.achievement_unlocks u
           JOIN aristo.badges b ON b.id=u.badge_id
           WHERE u.user_id='focus-track-student'
             AND b.track IN ('maratonista','senhor_do_tempo')`,
        )
      ).rows[0].total,
    ),
    2,
  );
  await assert.rejects(
    asApp("focus-track-other", "SELECT aristo.sync_track_achievements($1)", [
      "focus-track-student",
    ]),
    { code: "42501" },
  );
});

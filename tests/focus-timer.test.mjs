import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

async function migratedDb() {
  const db = new PGlite();
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  return db;
}

async function seed(db) {
  const scope = (
    await db.query(
      `SELECT t.id AS tenant_id,o.id AS organization_id FROM aristo.tenants t JOIN aristo.organizations o ON o.tenant_id=t.id WHERE t.slug='mentoria-coelho' AND o.name='Turma Inicial'`,
    )
  ).rows[0];
  await db.exec(`GRANT aristo_app TO postgres;
    INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
      ('focus-student','Student','focus-student@example.test','unused','student',0),
      ('focus-other','Other','focus-other@example.test','unused','student',0);
    INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES
      ('${scope.tenant_id}','focus-student','STUDENT'),('${scope.tenant_id}','focus-other','STUDENT');
    INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES
      ('${scope.tenant_id}','${scope.organization_id}','focus-student','STUDENT'),
      ('${scope.tenant_id}','${scope.organization_id}','focus-other','STUDENT');
    INSERT INTO aristo.study_sessions(id,user_id,data,tenant_id,organization_id) VALUES
      ('focus-plan','focus-student','{}','${scope.tenant_id}','${scope.organization_id}'),
      ('other-plan','focus-other','{}','${scope.tenant_id}','${scope.organization_id}');`);
  return scope;
}

function actorQuery(db, actor, sql, params = []) {
  return (async () => {
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
  })();
}

let sharedFixture;

async function fixture() {
  if (!sharedFixture) {
    const db = await migratedDb();
    const scope = await seed(db);
    sharedFixture = { db, scope };
  } else {
    await sharedFixture.db.exec(`TRUNCATE
      aristo.focus_session_events,
      aristo.focus_session_daily_credit,
      aristo.focus_sessions`);
  }
  const { db, scope } = sharedFixture;
  const asApp = (actor, sql, params = []) => actorQuery(db, actor, sql, params);
  return { db, scope, asApp };
}

after(async () => {
  if (sharedFixture) await sharedFixture.db.close();
});

async function start(asApp, command = randomUUID(), plan = null) {
  const result = await asApp(
    "focus-student",
    "SELECT aristo.focus_start_session($1,$2) AS id",
    [command, plan],
  );
  return { id: result.rows[0].id, command };
}

test("full start-pause-resume-end cycle derives net time and normalizes the reason", async () => {
  const { db, asApp } = await fixture();
  try {
    const session = await start(asApp, randomUUID(), "focus-plan");
    await db.query(
      "UPDATE aristo.focus_sessions SET started_at=clock_timestamp()-interval '5 minutes' WHERE id=$1",
      [session.id],
    );
    await db.query(
      "UPDATE aristo.focus_session_events SET occurred_at=clock_timestamp()-interval '5 minutes' WHERE session_id=$1 AND type='started'",
      [session.id],
    );
    await asApp("focus-student", "SELECT aristo.focus_pause_session($1,$2)", [
      randomUUID(),
      session.id,
    ]);
    await db.query(
      "UPDATE aristo.focus_session_events SET occurred_at=clock_timestamp()-interval '3 minutes' WHERE session_id=$1 AND type='paused'",
      [session.id],
    );
    await asApp(
      "focus-student",
      "SELECT aristo.focus_resume_session($1,$2,$3)",
      [randomUUID(), session.id, "  banheiro   rápido  "],
    );
    await db.query(
      "UPDATE aristo.focus_session_events SET occurred_at=clock_timestamp()-interval '2 minutes' WHERE session_id=$1 AND type='resumed'",
      [session.id],
    );
    await db.query(
      "UPDATE aristo.focus_sessions SET paused_seconds_total=60 WHERE id=$1",
      [session.id],
    );
    await asApp("focus-student", "SELECT aristo.focus_end_session($1,$2)", [
      randomUUID(),
      session.id,
    ]);
    const projection = (
      await db.query(
        "SELECT status,paused_seconds_total,net_seconds,counts_toward_maratonista FROM aristo.focus_sessions WHERE id=$1",
        [session.id],
      )
    ).rows[0];
    assert.equal(projection.status, "ENDED");
    assert.ok(projection.net_seconds >= 238 && projection.net_seconds <= 242);
    assert.ok(
      projection.paused_seconds_total >= 58 &&
        projection.paused_seconds_total <= 62,
    );
    assert.equal(projection.counts_toward_maratonista, true);
    assert.equal(
      (
        await db.query(
          "SELECT motivo FROM aristo.focus_session_events WHERE session_id=$1 AND type='resumed'",
          [session.id],
        )
      ).rows[0].motivo,
      "banheiro rápido",
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT sum(credited_focus_seconds) AS total FROM aristo.focus_session_daily_credit WHERE session_id=$1",
            [session.id],
          )
        ).rows[0].total,
      ),
      projection.net_seconds,
    );
  } finally {
    // The shared migrated database is reset by fixture() before the next case.
  }
});

test("command replay is idempotent and changed payload is a stable domain conflict", async () => {
  const { db, asApp } = await fixture();
  try {
    const command = randomUUID();
    const first = await start(asApp, command, null);
    const replay = await start(asApp, command, null);
    assert.equal(replay.id, first.id);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS total FROM aristo.focus_session_events WHERE command_id=$1",
            [command],
          )
        ).rows[0].total,
      ),
      1,
    );
    await assert.rejects(start(asApp, command, "focus-plan"), {
      code: "P0002",
      message: "focus command_id reused with different payload",
    });
  } finally {
    // The shared migrated database is reset by fixture() before the next case.
  }
});

test("active session and invalid transition expose stable domain conflicts", async () => {
  const { asApp } = await fixture();
  try {
    const session = await start(asApp);
    await assert.rejects(start(asApp), {
      code: "P0001",
      message: "focus session already active",
    });
    await asApp("focus-student", "SELECT aristo.focus_pause_session($1,$2)", [
      randomUUID(),
      session.id,
    ]);
    await assert.rejects(
      asApp("focus-student", "SELECT aristo.focus_pause_session($1,$2)", [
        randomUUID(),
        session.id,
      ]),
      { code: "P0001", message: "invalid focus session transition" },
    );
  } finally {
    // The shared migrated database is reset by fixture() before the next case.
  }
});

test("short session and the thirteenth qualifying session earn no credit", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    const short = await start(asApp);
    await db.query(
      "UPDATE aristo.focus_sessions SET started_at=clock_timestamp()-interval '2 minutes' WHERE id=$1",
      [short.id],
    );
    await db.query(
      "UPDATE aristo.focus_session_events SET occurred_at=clock_timestamp()-interval '2 minutes' WHERE session_id=$1",
      [short.id],
    );
    await asApp("focus-student", "SELECT aristo.focus_end_session($1,$2)", [
      randomUUID(),
      short.id,
    ]);
    assert.equal(
      (
        await db.query(
          "SELECT counts_toward_maratonista FROM aristo.focus_sessions WHERE id=$1",
          [short.id],
        )
      ).rows[0].counts_toward_maratonista,
      false,
    );

    await db.query(
      `INSERT INTO aristo.focus_sessions
        (id,user_id,tenant_id,organization_id,status,started_at,ended_at,paused_seconds_total,net_seconds,counts_toward_maratonista)
       SELECT gen_random_uuid(),'focus-student',$1,$2,'ENDED',clock_timestamp()-interval '4 minutes',
              clock_timestamp()-((13-n)*interval '1 second'),0,240,true
         FROM generate_series(1,12) n`,
      [scope.tenant_id, scope.organization_id],
    );
    const thirteenth = await start(asApp);
    await db.query(
      "UPDATE aristo.focus_sessions SET started_at=clock_timestamp()-interval '4 minutes' WHERE id=$1",
      [thirteenth.id],
    );
    await db.query(
      "UPDATE aristo.focus_session_events SET occurred_at=clock_timestamp()-interval '4 minutes' WHERE session_id=$1",
      [thirteenth.id],
    );
    await asApp("focus-student", "SELECT aristo.focus_end_session($1,$2)", [
      randomUUID(),
      thirteenth.id,
    ]);
    const row = (
      await db.query(
        "SELECT counts_toward_maratonista FROM aristo.focus_sessions WHERE id=$1",
        [thirteenth.id],
      )
    ).rows[0];
    assert.equal(row.counts_toward_maratonista, false);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS total FROM aristo.focus_session_daily_credit WHERE session_id=$1",
            [thirteenth.id],
          )
        ).rows[0].total,
      ),
      0,
    );
  } finally {
    // The shared migrated database is reset by fixture() before the next case.
  }
});

test("running intervals cross Bahia midnight and each day observes its own cap", async () => {
  const { db, asApp, scope } = await fixture();
  try {
    const session = await start(asApp);
    await db.query(
      `UPDATE aristo.focus_sessions
          SET started_at=((clock_timestamp() AT TIME ZONE 'America/Bahia')::date-1+time '23:58') AT TIME ZONE 'America/Bahia'
        WHERE id=$1`,
      [session.id],
    );
    await db.query(
      `UPDATE aristo.focus_session_events
          SET occurred_at=((clock_timestamp() AT TIME ZONE 'America/Bahia')::date-1+time '23:58') AT TIME ZONE 'America/Bahia'
        WHERE session_id=$1 AND type='started'`,
      [session.id],
    );
    await db.query(
      `INSERT INTO aristo.focus_session_events(session_id,user_id,tenant_id,organization_id,command_id,type,occurred_at,motivo)
       VALUES($1,'focus-student',$2,$3,gen_random_uuid(),'paused',
         (clock_timestamp() AT TIME ZONE 'America/Bahia')::date AT TIME ZONE 'America/Bahia',NULL),
        ($1,'focus-student',$2,$3,gen_random_uuid(),'resumed',clock_timestamp()-interval '2 minutes','midnight test')`,
      [session.id, scope.tenant_id, scope.organization_id],
    );
    const dates = (
      await db.query(
        "SELECT ((clock_timestamp() AT TIME ZONE 'America/Bahia')::date-1)::text AS previous_date,(clock_timestamp() AT TIME ZONE 'America/Bahia')::date::text AS current_date",
      )
    ).rows[0];
    for (const [id, date] of [
      ["10000000-0000-0000-0000-000000000001", dates.previous_date],
      ["10000000-0000-0000-0000-000000000002", dates.current_date],
    ]) {
      await db.query(
        `INSERT INTO aristo.focus_sessions
          (id,user_id,tenant_id,organization_id,status,started_at,ended_at,paused_seconds_total,net_seconds,counts_toward_maratonista)
         VALUES($1,'focus-student',$2,$3,'ENDED',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '10 minutes',0,21550,true);
        `,
        [id, scope.tenant_id, scope.organization_id],
      );
      await db.query(
        `INSERT INTO aristo.focus_session_daily_credit
          (session_id,local_date,user_id,tenant_id,organization_id,credited_focus_seconds)
         VALUES($1,$4,'focus-student',$2,$3,21550)`,
        [id, scope.tenant_id, scope.organization_id, date],
      );
    }
    await asApp("focus-student", "SELECT aristo.focus_end_session($1,$2)", [
      randomUUID(),
      session.id,
    ]);
    assert.deepEqual(
      (
        await db.query(
          "SELECT local_date::text,credited_focus_seconds FROM aristo.focus_session_daily_credit WHERE session_id=$1 ORDER BY local_date",
          [session.id],
        )
      ).rows,
      [
        { local_date: String(dates.previous_date), credited_focus_seconds: 50 },
        { local_date: String(dates.current_date), credited_focus_seconds: 50 },
      ],
    );
  } finally {
    // The shared migrated database is reset by fixture() before the next case.
  }
});

test("ending while paused succeeds and resuming without a reason is invalid", async () => {
  const { db, asApp } = await fixture();
  try {
    const session = await start(asApp);
    await asApp("focus-student", "SELECT aristo.focus_pause_session($1,$2)", [
      randomUUID(),
      session.id,
    ]);
    await assert.rejects(
      asApp("focus-student", "SELECT aristo.focus_resume_session($1,$2,$3)", [
        randomUUID(),
        session.id,
        "   ",
      ]),
      { code: "22023", message: "focus resume reason is required" },
    );
    await asApp("focus-student", "SELECT aristo.focus_end_session($1,$2)", [
      randomUUID(),
      session.id,
    ]);
    assert.equal(
      (
        await db.query("SELECT status FROM aristo.focus_sessions WHERE id=$1", [
          session.id,
        ])
      ).rows[0].status,
      "ENDED",
    );
  } finally {
    // The shared migrated database is reset by fixture() before the next case.
  }
});

test("RLS is self-only and aristo_app has no direct write privilege", async () => {
  const { db, asApp } = await fixture();
  try {
    await start(asApp);
    for (const table of [
      "focus_sessions",
      "focus_session_events",
      "focus_session_daily_credit",
    ]) {
      assert.equal(
        Number(
          (
            await asApp(
              "focus-other",
              `SELECT count(*) AS total FROM aristo.${table}`,
            )
          ).rows[0].total,
        ),
        0,
      );
      const grants = (
        await db.query(
          `SELECT p,has_table_privilege('aristo_app',$1,p) AS allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`,
          [`aristo.${table}`],
        )
      ).rows;
      assert.deepEqual(grants, [
        { p: "SELECT", allowed: true },
        { p: "INSERT", allowed: false },
        { p: "UPDATE", allowed: false },
        { p: "DELETE", allowed: false },
        { p: "TRUNCATE", allowed: false },
      ]);
    }
  } finally {
    // The shared migrated database is reset by fixture() before the next case.
  }
});

test("concurrent starts serialize and expose one domain conflict", async () => {
  const db = await migratedDb();
  await seed(db);
  const server = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 5,
  });
  await server.start();
  const pool = new pg.Pool({
    connectionString: `postgresql://postgres@${server.getServerConn()}/postgres`,
    max: 2,
  });
  const run = async (command) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE aristo_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [
        "focus-student",
      ]);
      const result = await client.query(
        "SELECT aristo.focus_start_session($1,NULL) AS id",
        [command],
      );
      await client.query("COMMIT");
      return result.rows[0].id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  try {
    const results = await Promise.allSettled([
      run(randomUUID()),
      run(randomUUID()),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const failure = results.find((r) => r.status === "rejected").reason;
    assert.equal(failure.code, "P0001");
    assert.equal(failure.message, "focus session already active");
  } finally {
    await pool.end();
    await server.stop();
    await db.close();
  }
});

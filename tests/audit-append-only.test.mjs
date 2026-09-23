import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = "202609230025_audit_logs_append_only.sql";
const update =
  "UPDATE aristo.audit_logs SET new_value='{}' WHERE id=$1 RETURNING id";
const remove = "DELETE FROM aristo.audit_logs WHERE id=$1 RETURNING id";
const policies = (db) =>
  db.query(
    "SELECT policyname,cmd,roles,qual,with_check FROM pg_policies WHERE schemaname='aristo' AND tablename='audit_logs' ORDER BY policyname",
  );

async function fixture(before = false) {
  const db = new PGlite();
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql") && (!before || f < migration))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  await db.exec(`GRANT aristo_app TO postgres;
    INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
      ('audit-admin','Admin','audit-admin@example.test','unused','student',0),
      ('audit-mentor','Mentor','audit-mentor@example.test','unused','mentor',0),
      ('audit-student','Student','audit-student@example.test','unused','student',0);
    INSERT INTO aristo.platform_admins(user_id) VALUES ('audit-admin');`);
  const asApp = async (actor, sql, params = []) => {
    await db.exec("BEGIN; SET LOCAL ROLE aristo_app");
    try {
      await db.query("SELECT set_config('app.user_id',$1,true)", [actor ?? ""]);
      const identity = (
        await db.query(
          "SELECT current_user AS role, aristo.is_platform_admin() AS admin",
        )
      ).rows[0];
      assert.equal(identity.role, "aristo_app");
      assert.equal(identity.admin, actor === "audit-admin");
      const result = await db.query(sql, params);
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  };
  const inserted = await asApp(
    "audit-admin",
    `INSERT INTO aristo.audit_logs(user_id,action,entity_type,entity_id,new_value)
    VALUES ('audit-admin','admin.set-role','user','audit-student','{"role":"mentor"}') RETURNING *`,
  );
  return { db, asApp, row: inserted.rows[0] };
}

test("audit baseline: platform_admin can UPDATE and DELETE before hardening", async () => {
  const { db, asApp, row } = await fixture(true);
  try {
    assert.equal((await asApp("audit-admin", update, [row.id])).rows.length, 1);
    assert.deepEqual(
      (
        await asApp(
          "audit-admin",
          "SELECT new_value FROM aristo.audit_logs WHERE id=$1",
          [row.id],
        )
      ).rows[0].new_value,
      {},
    );
    assert.equal((await asApp("audit-admin", remove, [row.id])).rows.length, 1);
    assert.equal(
      (await db.query("SELECT * FROM aristo.audit_logs")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("audit append-only: UPDATE and DELETE raise 42501 for every actor, including platform_admin; INSERT/SELECT survive", async () => {
  const { db, asApp, row } = await fixture();
  try {
    for (const actor of [
      "audit-admin",
      "audit-mentor",
      "audit-student",
      null,
    ]) {
      for (const sql of [update, remove]) {
        await assert.rejects(
          asApp(actor, sql, [row.id]),
          { code: "42501" },
          `${actor}: ${sql}`,
        );
      }
    }
    assert.deepEqual(
      (
        await asApp(
          "audit-admin",
          "SELECT * FROM aristo.audit_logs WHERE id=$1",
          [row.id],
        )
      ).rows,
      [row],
    );
    assert.equal(
      (await asApp("audit-student", "SELECT * FROM aristo.audit_logs")).rows
        .length,
      0,
    );
    for (const actor of ["audit-mentor", "audit-student", null]) {
      await assert.rejects(
        asApp(
          actor,
          "INSERT INTO aristo.audit_logs(action,entity_type) VALUES('forged','user')",
        ),
        { code: "42501" },
      );
    }
    const grants = (
      await db.query(
        `SELECT p,has_table_privilege('aristo_app','aristo.audit_logs',p) AS allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p`,
      )
    ).rows;
    assert.deepEqual(grants, [
      { p: "SELECT", allowed: true },
      { p: "INSERT", allowed: true },
      { p: "UPDATE", allowed: false },
      { p: "DELETE", allowed: false },
      { p: "TRUNCATE", allowed: false },
    ]);
    const columns = (
      await db.query(
        `SELECT attname,has_column_privilege('aristo_app',attrelid,attnum,'UPDATE') AS allowed FROM pg_attribute WHERE attrelid='aristo.audit_logs'::regclass AND attnum>0 AND NOT attisdropped`,
      )
    ).rows;
    assert.ok(columns.length >= 9);
    assert.ok(
      columns.every((c) => !c.allowed),
      "no effective column UPDATE privilege, including inherited grants",
    );
  } finally {
    await db.close();
  }
});

test("audit migration: preserves SELECT/INSERT policies, removes column grants, and each protection works independently", async () => {
  const { db, asApp, row } = await fixture(true);
  try {
    const before = (await policies(db)).rows.filter((p) =>
      ["SELECT", "INSERT"].includes(p.cmd),
    );
    // Verify table REVOKE also removes a separately granted column privilege.
    await db.exec(
      "GRANT UPDATE (new_value) ON aristo.audit_logs TO aristo_app",
    );
    await db.exec("REVOKE UPDATE, DELETE ON aristo.audit_logs FROM aristo_app");
    await assert.rejects(
      asApp(
        "audit-admin",
        "UPDATE aristo.audit_logs SET new_value=new_value WHERE id=$1 RETURNING id",
        [row.id],
      ),
      { code: "42501" },
    );
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    assert.deepEqual((await policies(db)).rows, before);
    for (const sql of [update, remove])
      await assert.rejects(asApp("audit-admin", sql, [row.id]), {
        code: "42501",
      });
    // Simulate an accidental column/table re-grant: missing write policies still deny rows.
    await db.exec(
      "GRANT UPDATE (new_value), DELETE ON aristo.audit_logs TO aristo_app",
    );
    for (const sql of [update, remove])
      assert.equal((await asApp("audit-admin", sql, [row.id])).rows.length, 0);
    assert.deepEqual(
      (await db.query("SELECT * FROM aristo.audit_logs WHERE id=$1", [row.id]))
        .rows,
      [row],
    );
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    // Simulate permissive policies returning: SQL privileges still reject the commands.
    await db.exec(`CREATE POLICY audit_logs_update ON aristo.audit_logs FOR UPDATE TO aristo_app USING (true) WITH CHECK (true);
      CREATE POLICY audit_logs_delete ON aristo.audit_logs FOR DELETE TO aristo_app USING (true)`);
    for (const sql of [update, remove])
      await assert.rejects(asApp("audit-admin", sql, [row.id]), {
        code: "42501",
      });
    assert.deepEqual(
      (await db.query("SELECT * FROM aristo.audit_logs WHERE id=$1", [row.id]))
        .rows,
      [row],
    );
  } finally {
    await db.close();
  }
});

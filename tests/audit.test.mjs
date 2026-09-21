import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { postgresSql } from "../src/server/postgres-config.mjs";

// The admin audit trail: one aristo.audit_logs row per sensitive admin action, written
// by recordAdminAction() (src/server/audit.ts). The end-to-end behaviour (the three
// real actions, nothing written for refused ones, the action surviving a broken log)
// is asserted by the Postgres e2e; here: the statement itself under real RLS, and a
// static guard that no secret can be handed to the log.

const parse = (path) => ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
const walk = (node, visit) => {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
};

function auditInsertSql() {
  let sql = null;
  walk(parse("src/server/audit.ts"), (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "prepare") {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg) && /INSERT INTO audit_logs/.test(arg.text)) sql = arg.text;
    }
  });
  assert.ok(sql, "could not find the audit INSERT in src/server/audit.ts");
  return sql;
}

async function fixture() {
  const db = new PGlite();
  for (const file of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec("GRANT aristo_app TO postgres");
  const [{ id: tenantId }] = (await db.query("SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'")).rows;
  await db.exec(`
    INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
      ('admin','Admin','admin@example.test','x','student',0),
      ('mentor','Mentor','mentor@example.test','x','mentor',0),
      ('student','Aluno','student@example.test','x','student',0);
    INSERT INTO aristo.platform_admins(user_id) VALUES ('admin');`);
  await db.query("INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES ($1,'student','STUDENT')", [tenantId]);
  const asApp = async (actor, sql, params) => {
    await db.exec("BEGIN");
    await db.exec("SET ROLE aristo_app");
    try {
      await db.query("SELECT set_config('app.user_id', $1, true)", [actor ?? ""]);
      const result = await db.query(sql, params);
      await db.exec("COMMIT");
      return result;
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    } finally {
      await db.exec("RESET ROLE");
    }
  };
  return { db, tenantId, asApp };
}

test("audit INSERT: written as the acting admin, with target, tenant and before/after values", async () => {
  const { db, tenantId, asApp } = await fixture();
  try {
    const sql = postgresSql(auditInsertSql());
    await asApp("admin", sql, ["student", "admin", "admin.set-role", "student", JSON.stringify({ role: "student" }), JSON.stringify({ role: "mentor" })]);
    await asApp("admin", sql, ["student", "admin", "admin.reset-password", "student", null, null]);
    const rows = (await db.query("SELECT user_id, action, entity_type, entity_id, tenant_id, old_value, new_value, created_at FROM aristo.audit_logs ORDER BY id")).rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(
      { user_id: rows[0].user_id, action: rows[0].action, entity_type: rows[0].entity_type, entity_id: rows[0].entity_id, tenant_id: rows[0].tenant_id, old_value: rows[0].old_value, new_value: rows[0].new_value },
      { user_id: "admin", action: "admin.set-role", entity_type: "user", entity_id: "student", tenant_id: tenantId, old_value: { role: "student" }, new_value: { role: "mentor" } },
    );
    assert.ok(rows[0].created_at, "timestamped by the database");
    assert.equal(rows[1].old_value, null);
    assert.equal(rows[1].new_value, null);
  } finally {
    await db.close();
  }
});

test("audit INSERT: only a platform admin can write audit rows (RLS), nobody else can even with a valid target", async () => {
  const { db, asApp } = await fixture();
  try {
    const sql = postgresSql(auditInsertSql());
    const params = ["student", "mentor", "admin.set-role", "student", null, null];
    await assert.rejects(asApp("mentor", sql, params), /row-level security/i);
    await assert.rejects(asApp("student", sql, params), /row-level security/i);
    await assert.rejects(asApp(null, sql, params), /row-level security/i);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM aristo.audit_logs")).rows[0].n), 0);
  } finally {
    await db.close();
  }
});

// Static guard: nothing secret-shaped may be passed to recordAdminAction().
export function auditSecretLeaks(text, name) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const leaks = [];
  walk(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "recordAdminAction") return;
    walk(node, (inner) => {
      const label = ts.isPropertyAssignment(inner) || ts.isShorthandPropertyAssignment(inner)
        ? inner.name.getText()
        : ts.isPropertyAccessExpression(inner) ? inner.name.text
          : ts.isIdentifier(inner) ? inner.text : null;
      if (label && /password|hash|token|secret|senha/i.test(label)) leaks.push(`${name}: recordAdminAction receives "${label}"`);
    });
  });
  return leaks;
}

test("the admin route never hands a password, hash or token to the audit log", () => {
  const source = readFileSync("src/app/api/admin/route.ts", "utf8");
  assert.deepEqual(auditSecretLeaks(source, "admin/route.ts"), []);
  // not vacuous: it really sees the three recorded actions
  assert.equal((source.match(/recordAdminAction\(/g) ?? []).length, 3);
  for (const action of ["admin.create-member", "admin.set-role", "admin.reset-password"]) assert.ok(source.includes(action), action);
});

test("the secret guard catches a leak (fixtures)", () => {
  assert.deepEqual(auditSecretLeaks(`recordAdminAction({ actorId: a, action: "x", targetUserId: t, newValue: { role: r } });`, "f.ts"), []);
  assert.equal(auditSecretLeaks(`recordAdminAction({ actorId: a, action: "x", targetUserId: t, newValue: { password: data.password } });`, "f.ts").length >= 1, true);
  assert.equal(auditSecretLeaks(`recordAdminAction({ actorId: a, action: "x", targetUserId: t, newValue: { h: passwordHash } });`, "f.ts").length >= 1, true);
});

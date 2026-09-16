import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { postgresSql, postgresConfig } from "../src/server/postgres-config.mjs";

test("remote PostgreSQL verifies TLS even if URL requests no verification", () => {
  const config = postgresConfig({
    DATABASE_URL: "postgresql://user:secret@example.org/db?sslmode=no-verify",
  });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.ok(!config.connectionString.includes("sslmode"));
  assert.equal(
    postgresConfig({ DATABASE_URL: "postgresql://localhost/test" }).ssl,
    false,
  );
});

test("all application SQL compiles against the PostgreSQL migration", async () => {
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const files = [
      "src/server/auth.ts",
      "src/server/http.ts",
      "src/server/study.ts",
      "src/server/mentor.ts",
      "src/server/identity.ts",
      "src/server/authorization.ts",
      "src/app/api/auth/route.ts",
      "src/app/api/mentor/route.ts",
      "src/app/api/health/route.ts",
      "src/app/api/auth/recovery/route.ts",
    ];
    let queries = 0;
    for (const file of files) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const sqls = [];
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "prepare"
        ) {
          assert.ok(
            ts.isStringLiteralLike(node.arguments[0]),
            "SQL must be a fixed string",
          );
          sqls.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      for (const sql of sqls) {
        const converted = postgresSql(sql);
        const count = Math.max(
          0,
          ...[...converted.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
        );
        await db.query(`EXPLAIN ${converted}`, Array(count).fill(null));
        queries++;
      }
    }
    assert.ok(queries >= 35);
    await db.exec(
      "INSERT INTO aristo.users(id,name,email,password,created_at) VALUES('a','A','a@example.test','hash',0),('b','B','b@example.test','hash',0)",
    );
    // Fase 2A: items/records now require tenant_id/organization_id.
    const [scopeTenant] = (
      await db.query("SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'")
    ).rows;
    const [scopeOrg] = (
      await db.query(
        "SELECT id FROM aristo.organizations WHERE tenant_id=$1 AND name='Turma Inicial'",
        [scopeTenant.id],
      )
    ).rows;
    await db.exec(
      `INSERT INTO aristo.items(id,user_id,data,tenant_id,organization_id) VALUES('i','a','{}','${scopeTenant.id}','${scopeOrg.id}')`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO aristo.records(user_id,item_id,date,target,tenant_id,organization_id) VALUES('b','i','2026-09-15',1,'${scopeTenant.id}','${scopeOrg.id}')`,
      ),
      /foreign key/i,
    );
    // Fase 0C: deleting a user must cascade into aristo.profiles and
    // aristo.tenant_members — there is no account-deletion endpoint in the
    // app yet, so this exercises the FK constraints directly.
    await db.exec(
      "INSERT INTO aristo.profiles(user_id,full_name) VALUES('a','A')",
    );
    await db.exec(
      `INSERT INTO aristo.tenant_members(tenant_id,user_id,role)
       SELECT id,'a','STUDENT' FROM aristo.tenants WHERE slug='mentoria-coelho'`,
    );
    await db.exec("DELETE FROM aristo.users WHERE id='a'");
    assert.equal(
      (await db.query("SELECT count(*) AS total FROM aristo.profiles WHERE user_id='a'"))
        .rows[0].total,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) AS total FROM aristo.tenant_members WHERE user_id='a'",
        )
      ).rows[0].total,
      0,
    );
    // SUPER_ADMIN is never a tenant_members value — the CHECK constraint
    // enforces this even if application code ever tried it by mistake.
    await assert.rejects(
      db.exec(
        `INSERT INTO aristo.tenant_members(tenant_id,user_id,role)
         SELECT id,'b','SUPER_ADMIN' FROM aristo.tenants WHERE slug='mentoria-coelho'`,
      ),
      /check/i,
    );
    await db.exec("CREATE ROLE client_test; SET ROLE client_test");
    await assert.rejects(
      db.query("SELECT * FROM aristo.users"),
      /permission denied/i,
    );
    await db.exec("RESET ROLE");
    const aliases = await db.query(
      postgresSql('SELECT item_id AS "itemId" FROM records WHERE user_id=?'),
      ["a"],
    );
    assert.equal(aliases.fields[0].name, "itemId");
  } finally {
    await db.close();
  }
});

test("Fase 1 backfill enrolls every Tenant 01 member into Turma Inicial", async () => {
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

    await db.exec(`
      INSERT INTO aristo.users (id, name, email, password, role, created_at)
      VALUES
        ('org-mentor', 'Ana Mentor', 'ana-org@example.test', 'x', 'mentor', 1700000000000),
        ('org-student', 'Bia Aluna', 'bia-org@example.test', 'x', 'student', 1700000001000);
    `);
    await db.exec(`
      INSERT INTO aristo.profiles (user_id, full_name)
      VALUES ('org-mentor', 'Ana Mentor'), ('org-student', 'Bia Aluna');
      INSERT INTO aristo.tenant_members (tenant_id, user_id, role)
      SELECT id, 'org-mentor', 'MENTOR' FROM aristo.tenants WHERE slug='mentoria-coelho';
      INSERT INTO aristo.tenant_members (tenant_id, user_id, role)
      SELECT id, 'org-student', 'STUDENT' FROM aristo.tenants WHERE slug='mentoria-coelho';
    `);
    // Re-run the backfill migration's own statements to prove the same
    // idempotent logic also enrolls members added after Fase 0B, not just
    // whoever existed at the moment 006 first ran.
    await db.exec(
      readFileSync(
        "supabase/migrations/202609150006_organizations_backfill.sql",
        "utf8",
      ),
    );

    const orgs = await db.query(
      "SELECT name FROM aristo.organizations WHERE name='Turma Inicial'",
    );
    assert.equal(orgs.rows.length, 1, "deve haver exatamente uma Turma Inicial");

    const members = await db.query(`
      SELECT om.user_id, om.member_role
      FROM aristo.organization_members om
      JOIN aristo.organizations o ON o.id = om.organization_id
      WHERE o.name = 'Turma Inicial' AND om.user_id IN ('org-mentor','org-student')
      ORDER BY om.user_id
    `);
    assert.deepEqual(
      members.rows.map((r) => [r.user_id, r.member_role]),
      [
        ["org-mentor", "MENTOR"],
        ["org-student", "STUDENT"],
      ],
    );

    // Re-running the same backfill statements again must not duplicate rows.
    await db.exec(
      readFileSync(
        "supabase/migrations/202609150006_organizations_backfill.sql",
        "utf8",
      ),
    );
    const total = await db.query(
      `SELECT count(*) AS total FROM aristo.organization_members WHERE user_id IN ('org-mentor','org-student')`,
    );
    assert.equal(Number(total.rows[0].total), 2);

    // TENANT_ADMIN would never be auto-enrolled by this backfill (it filters
    // on role IN ('MENTOR','STUDENT')); organization_members.member_role
    // itself also rejects anything outside MENTOR/STUDENT. Uses a second,
    // otherwise-unused organization so this only exercises the CHECK
    // constraint, not the (organization_id,user_id) UNIQUE constraint.
    const [tenant] = (
      await db.query("SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'")
    ).rows;
    await db.exec(
      `INSERT INTO aristo.organizations(tenant_id,name) VALUES ('${tenant.id}','Turma Secundária')`,
    );
    const [otherOrg] = (
      await db.query(
        "SELECT id FROM aristo.organizations WHERE name='Turma Secundária'",
      )
    ).rows;
    await assert.rejects(
      db.exec(
        `INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role)
         VALUES ('${tenant.id}','${otherOrg.id}','org-student','SUPER_ADMIN')`,
      ),
      /check/i,
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B authorization functions compute correctly, without recursion", async () => {
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

    // Run a query as a given actor, inside its own transaction — mirrors
    // exactly what src/server/database.ts does (SET LOCAL via
    // set_config(..., true), never a session-level SET).
    async function asActor(userId, sql, params = []) {
      await db.exec("BEGIN");
      try {
        await db.query("SELECT set_config('app.user_id', $1, true)", [
          userId ?? "",
        ]);
        const result = await db.query(sql, params);
        await db.exec("COMMIT");
        return result.rows[0];
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      }
    }

    const [{ id: tenantAId }] = (
      await db.query("SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'")
    ).rows;
    const [{ id: orgAId }] = (
      await db.query(
        "SELECT id FROM aristo.organizations WHERE tenant_id=$1 AND name='Turma Inicial'",
        [tenantAId],
      )
    ).rows;

    // A second, independent tenant — not used for RLS policy isolation yet
    // (no policies exist on the tables in this migration), only to prove
    // the functions themselves distinguish tenants correctly.
    const [{ id: tenantBId }] = (
      await db.query(
        "INSERT INTO aristo.tenants(name,slug) VALUES('Tenant B','tenant-b') RETURNING id",
      )
    ).rows;
    const [{ id: orgBId }] = (
      await db.query(
        "INSERT INTO aristo.organizations(tenant_id,name) VALUES($1,'Turma B') RETURNING id",
        [tenantBId],
      )
    ).rows;

    await db.exec(`
      INSERT INTO aristo.users (id,name,email,password,role,created_at) VALUES
        ('platform-admin','Admin','admin@example.test','x','student',0),
        ('tenant-admin-a','TAdminA','tadmina@example.test','x','student',0),
        ('mentor-a','MentorA','mentora@example.test','x','mentor',0),
        ('student-a1','StudentA1','a1@example.test','x','student',0),
        ('student-a2','StudentA2','a2@example.test','x','student',0),
        ('mentor-b','MentorB','mentorb@example.test','x','mentor',0);
    `);
    await db.query(
      "INSERT INTO aristo.platform_admins(user_id) VALUES ('platform-admin')",
    );
    await db.query(
      "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES ($1,'tenant-admin-a','TENANT_ADMIN')",
      [tenantAId],
    );
    for (const [userId, role] of [
      ["mentor-a", "MENTOR"],
      ["student-a1", "STUDENT"],
      ["student-a2", "STUDENT"],
    ]) {
      await db.query(
        "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES ($1,$2,$3)",
        [tenantAId, userId, role],
      );
      await db.query(
        "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES ($1,$2,$3,$4)",
        [tenantAId, orgAId, userId, role],
      );
    }
    await db.query(
      "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES ($1,'mentor-b','MENTOR')",
      [tenantBId],
    );
    await db.query(
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES ($1,$2,'mentor-b','MENTOR')",
      [tenantBId, orgBId],
    );
    await db.query(
      "INSERT INTO aristo.mentor_students(mentor_id,student_id) VALUES ('mentor-a','student-a1')",
    );

    // is_platform_admin: no recursion (platform_admins' own policy would be
    // "self row" once it exists — this function doesn't need SECURITY
    // DEFINER at all, see the migration comment).
    assert.equal(
      (await asActor("platform-admin", "SELECT aristo.is_platform_admin() AS v")).v,
      true,
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT aristo.is_platform_admin() AS v")).v,
      false,
    );

    // is_tenant_admin / can_manage_tenant: correctly scoped per tenant, no
    // "stack depth limit exceeded" from the SECURITY DEFINER functions
    // querying tenant_members from inside a tenant_members-derived check.
    assert.equal(
      (await asActor("tenant-admin-a", "SELECT aristo.is_tenant_admin($1) AS v", [tenantAId])).v,
      true,
    );
    assert.equal(
      (await asActor("tenant-admin-a", "SELECT aristo.is_tenant_admin($1) AS v", [tenantBId])).v,
      false,
      "admin do Tenant A não deve administrar o Tenant B",
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT aristo.can_manage_tenant($1) AS v", [tenantAId])).v,
      false,
      "mentor não administra o tenant, só a própria organização",
    );

    // is_organization_mentor / can_manage_organization
    assert.equal(
      (await asActor("mentor-a", "SELECT aristo.is_organization_mentor($1) AS v", [orgAId])).v,
      true,
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT aristo.is_organization_mentor($1) AS v", [orgBId])).v,
      false,
      "mentor do Tenant A não é mentor da organização do Tenant B",
    );
    assert.equal(
      (await asActor("mentor-b", "SELECT aristo.can_manage_organization($1) AS v", [orgAId])).v,
      false,
    );

    // can_access_student: self, linked mentor, unrelated mentor, cross-tenant admin.
    assert.equal(
      (await asActor("student-a1", "SELECT aristo.can_access_student($1,$2) AS v", ["student-a1", orgAId])).v,
      true,
      "sempre pode acessar os próprios dados",
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT aristo.can_access_student($1,$2) AS v", ["student-a1", orgAId])).v,
      true,
      "mentor-a tem vínculo mentor_students com student-a1",
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT aristo.can_access_student($1,$2) AS v", ["student-a2", orgAId])).v,
      false,
      "mentor-a não tem vínculo com student-a2",
    );
    assert.equal(
      (await asActor("mentor-b", "SELECT aristo.can_access_student($1,$2) AS v", ["student-a1", orgAId])).v,
      false,
      "mentor de outro tenant não acessa aluno do Tenant A",
    );
    assert.equal(
      (await asActor("tenant-admin-a", "SELECT aristo.can_access_student($1,$2) AS v", ["student-a1", orgAId])).v,
      true,
      "admin do próprio tenant acessa qualquer aluno dele",
    );
    assert.equal(
      (await asActor("platform-admin", "SELECT aristo.can_access_student($1,$2) AS v", ["student-a1", orgAId])).v,
      true,
    );

    // find_user_by_email / verify_login_credential: work with NO actor set
    // at all (actor = null) — this is the whole point of these two
    // functions, see the migration comment.
    await db.exec("BEGIN");
    await db.query("SELECT set_config('app.user_id', '', true)");
    const found = (
      await db.query("SELECT * FROM aristo.find_user_by_email($1)", [
        "a1@example.test",
      ])
    ).rows[0];
    assert.deepEqual(found, { id: "student-a1", role: "student" });
    const credential = (
      await db.query("SELECT * FROM aristo.verify_login_credential($1)", [
        "mentora@example.test",
      ])
    ).rows[0];
    assert.equal(credential.id, "mentor-a");
    assert.equal(credential.password, "x");
    await db.exec("COMMIT");
  } finally {
    await db.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
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
      "src/server/audit.ts",
      "src/app/api/auth/route.ts",
      "src/app/api/mentor/route.ts",
      "src/app/api/health/route.ts",
      "src/app/api/auth/recovery/route.ts",
      "src/app/api/admin/route.ts",
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

test("Fase 3B authorization functions fail closed with no actor context at all", async () => {
  // Simulates a fresh connection where nobody ever called setActor() —
  // an administrative script, a migration, or any query that runs before
  // src/server/auth.ts's currentUser() resolves a session. No
  // set_config('app.user_id', ...) call happens anywhere in this test.
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

    const [{ id: tenantId }] = (
      await db.query("SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'")
    ).rows;
    const [{ id: orgId }] = (
      await db.query(
        "SELECT id FROM aristo.organizations WHERE tenant_id=$1 AND name='Turma Inicial'",
        [tenantId],
      )
    ).rows;
    await db.exec(
      "INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES('someone','S','s@example.test','x','student',0)",
    );

    // "Falsy" (NULL or false), never true, never an error — a NULL from a
    // boolean-valued SQL function is what a bare OR-chain naturally
    // produces when every branch is NULL/false, and RLS treats NULL in
    // USING/WITH CHECK exactly like false (the row is excluded either
    // way), so this is a safe, correct outcome, not just an accepted one.
    const checks = [
      ["current_user_id()", null],
      ["is_platform_admin()", false],
      ["current_tenant_id()", null],
      [`is_tenant_admin('${tenantId}')`, false],
      [`is_tenant_member('${tenantId}')`, false],
      [`can_manage_tenant('${tenantId}')`, false],
      [`is_organization_mentor('${orgId}')`, false],
      [`is_organization_member('${orgId}')`, false],
      [`can_manage_organization('${orgId}')`, false],
      [`can_access_student('someone', '${orgId}')`, false],
      [`can_access_business_row('someone', '${tenantId}', '${orgId}')`, false],
    ];
    for (const [call, expected] of checks) {
      const { rows } = await db.query(`SELECT aristo.${call} AS v`);
      const value = rows[0].v;
      assert.ok(
        value === null || value === false,
        `${call} deveria ser NULL ou false sem contexto, veio ${JSON.stringify(value)}`,
      );
      if (expected === false)
        assert.notEqual(value, true, `${call} nunca pode ser true sem contexto`);
    }

    // The two email-lookup functions are meant to work with no actor at
    // all (that's their whole purpose) — confirm they still do, and that
    // an unmatched email safely returns no rows rather than erroring.
    const found = await db.query(
      "SELECT * FROM aristo.find_user_by_email('s@example.test')",
    );
    assert.equal(found.rows[0].id, "someone");
    const notFound = await db.query(
      "SELECT * FROM aristo.find_user_by_email('nobody@example.test')",
    );
    assert.equal(notFound.rows.length, 0);
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 1: platform_admins and tenants enforce isolation as aristo_app", async () => {
  // Tenant B exists only inside this disposable fixture, not on the real
  // Supabase database — this proves isolation without leaving permanent
  // fake data in what is meant to become a real production database.
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

    // aristo_app is NOLOGIN; SET ROLE requires membership, exactly the
    // same grant needed (and left permanently in place) on the real
    // Supabase database for this same reason.
    await db.exec("GRANT aristo_app TO postgres");

    const [{ id: tenantAId }] = (
      await db.query("SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'")
    ).rows;
    const [{ id: tenantBId }] = (
      await db.query(
        "INSERT INTO aristo.tenants(name,slug) VALUES('Tenant B','tenant-b') RETURNING id",
      )
    ).rows;

    await db.exec(`
      INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
        ('platform-admin','Admin','admin@example.test','x','student',0),
        ('tenant-admin-a','TAdminA','ta@example.test','x','student',0),
        ('mentor-a','MentorA','ma@example.test','x','mentor',0),
        ('student-a','StudentA','sa@example.test','x','student',0),
        ('tenant-admin-b','TAdminB','tb@example.test','x','student',0),
        ('mentor-b','MentorB','mb@example.test','x','mentor',0),
        ('student-b','StudentB','sb@example.test','x','student',0);
    `);
    await db.query("INSERT INTO aristo.platform_admins(user_id) VALUES ('platform-admin')");
    for (const [tenantId, userId, role] of [
      [tenantAId, "tenant-admin-a", "TENANT_ADMIN"],
      [tenantAId, "mentor-a", "MENTOR"],
      [tenantAId, "student-a", "STUDENT"],
      [tenantBId, "tenant-admin-b", "TENANT_ADMIN"],
      [tenantBId, "mentor-b", "MENTOR"],
      [tenantBId, "student-b", "STUDENT"],
    ])
      await db.query(
        "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES ($1,$2,$3)",
        [tenantId, userId, role],
      );

    // Runs one statement as a given actor, under aristo_app, in its own
    // transaction — SET ROLE is session-level (unlike SET LOCAL) and
    // survives ROLLBACK, so it's always explicitly reset in `finally`,
    // after the transaction has already been committed or rolled back.
    async function asActor(userId, sql, params = []) {
      await db.exec("BEGIN");
      await db.exec("SET ROLE aristo_app");
      try {
        await db.query("SELECT set_config('app.user_id', $1, true)", [
          userId ?? "",
        ]);
        const result = await db.query(sql, params);
        await db.exec("COMMIT");
        return result;
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      } finally {
        await db.exec("RESET ROLE");
      }
    }
    const asOwner = (sql, params = []) => db.query(sql, params);

    // platform_admin: full visibility and write access to both tables,
    // across both tenants.
    assert.equal(
      (await asActor("platform-admin", "SELECT user_id FROM aristo.platform_admins")).rows.length,
      1,
    );
    assert.deepEqual(
      (await asActor("platform-admin", "SELECT slug FROM aristo.tenants ORDER BY slug")).rows.map((r) => r.slug),
      ["mentoria-coelho", "tenant-b"],
    );
    const [{ id: tenantCId }] = (
      await asActor(
        "platform-admin",
        "INSERT INTO aristo.tenants(name,slug) VALUES('Tenant C','tenant-c') RETURNING id",
      )
    ).rows;
    await asActor(
      "platform-admin",
      "UPDATE aristo.tenants SET name='Tenant C Renamed' WHERE id=$1",
      [tenantCId],
    );
    assert.equal(
      (await asOwner("SELECT name FROM aristo.tenants WHERE id=$1", [tenantCId])).rows[0].name,
      "Tenant C Renamed",
    );
    await asActor("platform-admin", "DELETE FROM aristo.tenants WHERE id=$1", [tenantCId]);
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.tenants WHERE id=$1", [tenantCId])).rows.length,
      0,
    );

    // tenant-admin-a: sees only Tenant A, can update it, cannot touch
    // Tenant B, cannot create or delete any tenant, no access at all to
    // platform_admins (being a tenant admin is not being a platform admin).
    assert.deepEqual(
      (await asActor("tenant-admin-a", "SELECT slug FROM aristo.tenants")).rows.map((r) => r.slug),
      ["mentoria-coelho"],
    );
    await asActor(
      "tenant-admin-a",
      "UPDATE aristo.tenants SET name='Mentoria Coelho Atualizada' WHERE id=$1",
      [tenantAId],
    );
    assert.equal(
      (await asOwner("SELECT name FROM aristo.tenants WHERE id=$1", [tenantAId])).rows[0].name,
      "Mentoria Coelho Atualizada",
    );
    assert.equal(
      (
        await asActor(
          "tenant-admin-a",
          "UPDATE aristo.tenants SET name='Sequestrado' WHERE id=$1",
          [tenantBId],
        )
      ).rowCount,
      0,
      "tenant B é invisível para tenant-admin-a — a linha nem entra no alvo do UPDATE",
    );
    await assert.rejects(
      asActor("tenant-admin-a", "INSERT INTO aristo.tenants(name,slug) VALUES('X','tenant-x')"),
      /row-level security/i,
    );
    assert.equal(
      (await asActor("tenant-admin-a", "DELETE FROM aristo.tenants WHERE id=$1", [tenantAId])).rowCount,
      0,
      "só platform_admin pode deletar tenant, mesmo o admin do próprio tenant",
    );
    assert.equal(
      (await asActor("tenant-admin-a", "SELECT * FROM aristo.platform_admins")).rows.length,
      0,
    );

    // mentor-a / student-a: read-only visibility of their own tenant, zero
    // write access, zero visibility into platform_admins or Tenant B.
    for (const memberId of ["mentor-a", "student-a"]) {
      assert.deepEqual(
        (await asActor(memberId, "SELECT slug FROM aristo.tenants")).rows.map((r) => r.slug),
        ["mentoria-coelho"],
      );
      assert.equal(
        (await asActor(memberId, "UPDATE aristo.tenants SET name='Invasão' WHERE id=$1", [tenantAId])).rowCount,
        0,
      );
      assert.equal(
        (await asActor(memberId, "SELECT * FROM aristo.platform_admins")).rows.length,
        0,
      );
    }
    await assert.rejects(
      asActor("student-a", "INSERT INTO aristo.tenants(name,slug) VALUES('Y','tenant-y')"),
      /row-level security/i,
    );

    // Tenant B's own admin/mentor/student: symmetric to Tenant A, proving
    // this isn't special-cased to one side.
    assert.deepEqual(
      (await asActor("tenant-admin-b", "SELECT slug FROM aristo.tenants")).rows.map((r) => r.slug),
      ["tenant-b"],
    );
    assert.equal(
      (
        await asActor(
          "tenant-admin-b",
          "UPDATE aristo.tenants SET name='Sequestrado' WHERE id=$1",
          [tenantAId],
        )
      ).rowCount,
      0,
      "tenant-admin-b não administra o Tenant A",
    );

    // No context at all (no session, matching a pre-auth or admin-script
    // query): zero visibility on both tables, never an error.
    assert.equal((await asActor(null, "SELECT * FROM aristo.tenants")).rows.length, 0);
    assert.equal((await asActor(null, "SELECT * FROM aristo.platform_admins")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 2: tenant_settings and organizations enforce isolation as aristo_app", async () => {
  // Same fixture shape as batch 1 (Tenant B only inside this disposable
  // PGlite instance, never written to the real Supabase database), extended
  // with each tenant's own organization and organization_members.
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.exec("GRANT aristo_app TO postgres");

    const [{ id: tenantAId }] = (
      await db.query("SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'")
    ).rows;
    const [{ id: orgAId }] = (
      await db.query(
        "SELECT id FROM aristo.organizations WHERE tenant_id=$1 AND name='Turma Inicial'",
        [tenantAId],
      )
    ).rows;
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
      INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
        ('platform-admin','Admin','admin@example.test','x','student',0),
        ('tenant-admin-a','TAdminA','ta@example.test','x','student',0),
        ('mentor-a','MentorA','ma@example.test','x','mentor',0),
        ('student-a','StudentA','sa@example.test','x','student',0),
        ('tenant-admin-b','TAdminB','tb@example.test','x','student',0),
        ('mentor-b','MentorB','mb@example.test','x','mentor',0),
        ('student-b','StudentB','sb@example.test','x','student',0);
    `);
    await db.query("INSERT INTO aristo.platform_admins(user_id) VALUES ('platform-admin')");
    for (const [tenantId, userId, role] of [
      [tenantAId, "tenant-admin-a", "TENANT_ADMIN"],
      [tenantAId, "mentor-a", "MENTOR"],
      [tenantAId, "student-a", "STUDENT"],
      [tenantBId, "tenant-admin-b", "TENANT_ADMIN"],
      [tenantBId, "mentor-b", "MENTOR"],
      [tenantBId, "student-b", "STUDENT"],
    ])
      await db.query(
        "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES ($1,$2,$3)",
        [tenantId, userId, role],
      );
    for (const [tenantId, orgId, userId, role] of [
      [tenantAId, orgAId, "mentor-a", "MENTOR"],
      [tenantAId, orgAId, "student-a", "STUDENT"],
      [tenantBId, orgBId, "mentor-b", "MENTOR"],
      [tenantBId, orgBId, "student-b", "STUDENT"],
    ])
      await db.query(
        "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES ($1,$2,$3,$4)",
        [tenantId, orgId, userId, role],
      );
    // Fase 0B seeded Tenant A's tenant_settings already (migration 004);
    // Tenant B needs its own row for this batch's tests.
    await db.query(
      "INSERT INTO aristo.tenant_settings(tenant_id,platform_name) VALUES ($1,'Tenant B')",
      [tenantBId],
    );

    async function asActor(userId, sql, params = []) {
      await db.exec("BEGIN");
      await db.exec("SET ROLE aristo_app");
      try {
        await db.query("SELECT set_config('app.user_id', $1, true)", [
          userId ?? "",
        ]);
        const result = await db.query(sql, params);
        await db.exec("COMMIT");
        return result;
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      } finally {
        await db.exec("RESET ROLE");
      }
    }
    const asOwner = (sql, params = []) => db.query(sql, params);

    // platform_admin: sees and edits both tables across both tenants.
    assert.deepEqual(
      (await asActor("platform-admin", "SELECT platform_name FROM aristo.tenant_settings ORDER BY platform_name")).rows.map((r) => r.platform_name),
      ["Plataforma Coelho", "Tenant B"],
    );
    assert.deepEqual(
      (await asActor("platform-admin", "SELECT name FROM aristo.organizations ORDER BY name")).rows.map((r) => r.name),
      ["Turma B", "Turma Inicial"],
    );
    await asActor(
      "platform-admin",
      "UPDATE aristo.tenant_settings SET platform_name='Tenant B Renomeado' WHERE tenant_id=$1",
      [tenantBId],
    );
    assert.equal(
      (await asOwner("SELECT platform_name FROM aristo.tenant_settings WHERE tenant_id=$1", [tenantBId])).rows[0].platform_name,
      "Tenant B Renomeado",
    );
    const [{ id: orgTempId }] = (
      await asActor(
        "platform-admin",
        "INSERT INTO aristo.organizations(tenant_id,name) VALUES($1,'Turma Temporária') RETURNING id",
        [tenantAId],
      )
    ).rows;
    await asActor("platform-admin", "DELETE FROM aristo.organizations WHERE id=$1", [orgTempId]);
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.organizations WHERE id=$1", [orgTempId])).rows.length,
      0,
    );

    // tenant-admin-a: full read/write within Tenant A, zero visibility or
    // write access into Tenant B's rows of either table.
    assert.deepEqual(
      (await asActor("tenant-admin-a", "SELECT platform_name FROM aristo.tenant_settings")).rows.map((r) => r.platform_name),
      ["Plataforma Coelho"],
    );
    await asActor(
      "tenant-admin-a",
      "UPDATE aristo.tenant_settings SET support_email='suporte@coelho.test' WHERE tenant_id=$1",
      [tenantAId],
    );
    assert.equal(
      (await asOwner("SELECT support_email FROM aristo.tenant_settings WHERE tenant_id=$1", [tenantAId])).rows[0].support_email,
      "suporte@coelho.test",
    );
    assert.equal(
      (
        await asActor(
          "tenant-admin-a",
          "UPDATE aristo.tenant_settings SET platform_name='Sequestrado' WHERE tenant_id=$1",
          [tenantBId],
        )
      ).rowCount,
      0,
    );
    assert.deepEqual(
      (await asActor("tenant-admin-a", "SELECT name FROM aristo.organizations")).rows.map((r) => r.name),
      ["Turma Inicial"],
    );
    await asActor(
      "tenant-admin-a",
      "UPDATE aristo.organizations SET name='Turma Inicial Renomeada' WHERE id=$1",
      [orgAId],
    );
    assert.equal(
      (await asOwner("SELECT name FROM aristo.organizations WHERE id=$1", [orgAId])).rows[0].name,
      "Turma Inicial Renomeada",
    );
    assert.equal(
      (await asActor("tenant-admin-a", "UPDATE aristo.organizations SET name='Sequestrado' WHERE id=$1", [orgBId])).rowCount,
      0,
    );
    assert.equal(
      (await asActor("tenant-admin-a", "DELETE FROM aristo.organizations WHERE id=$1", [orgBId])).rowCount,
      0,
    );

    // mentor-a: read-only on tenant_settings, but CAN update (not delete)
    // the organization they mentor in — can_manage_organization()
    // deliberately includes the org's own mentor for UPDATE, unlike
    // tenant_settings which has no mentor-level write case at all.
    assert.equal(
      (
        await asActor(
          "mentor-a",
          "UPDATE aristo.tenant_settings SET platform_name='Invasão' WHERE tenant_id=$1",
          [tenantAId],
        )
      ).rowCount,
      0,
    );
    await asActor(
      "mentor-a",
      "UPDATE aristo.organizations SET description='Atualizado pelo mentor' WHERE id=$1",
      [orgAId],
    );
    assert.equal(
      (await asOwner("SELECT description FROM aristo.organizations WHERE id=$1", [orgAId])).rows[0].description,
      "Atualizado pelo mentor",
    );
    assert.equal(
      (await asActor("mentor-a", "DELETE FROM aristo.organizations WHERE id=$1", [orgAId])).rowCount,
      0,
      "mentor pode atualizar, mas não deletar a própria organização",
    );

    // student-a: read-only on both tables, no exceptions.
    assert.deepEqual(
      (await asActor("student-a", "SELECT name FROM aristo.organizations")).rows.map((r) => r.name),
      ["Turma Inicial Renomeada"],
    );
    assert.equal(
      (
        await asActor(
          "student-a",
          "UPDATE aristo.organizations SET name='Invasão' WHERE id=$1",
          [orgAId],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await asActor(
          "student-a",
          "UPDATE aristo.tenant_settings SET platform_name='Invasão' WHERE tenant_id=$1",
          [tenantAId],
        )
      ).rowCount,
      0,
    );

    // No actor context at all: zero visibility on both tables, no error.
    assert.equal((await asActor(null, "SELECT * FROM aristo.tenant_settings")).rows.length, 0);
    assert.equal((await asActor(null, "SELECT * FROM aristo.organizations")).rows.length, 0);
  } finally {
    await db.close();
  }
});

// Fase 3B part 5, batch 3: shared fixture builder for items/records/plans/
// questions/study_sessions' isolation tests. Each of the 5 tests below
// calls this with its *own* fresh PGlite instance — the setup code is
// shared to avoid five copies of the same boilerplate, but no database
// state is shared between the 5 tables' tests, exactly so a quirk unique
// to one table can't hide behind the other four passing.
async function buildTwoTenantFixture(db) {
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec("GRANT aristo_app TO postgres");

  const [{ id: tenantAId }] = (
    await db.query("SELECT id FROM aristo.tenants WHERE slug='mentoria-coelho'")
  ).rows;
  const [{ id: orgAId }] = (
    await db.query(
      "SELECT id FROM aristo.organizations WHERE tenant_id=$1 AND name='Turma Inicial'",
      [tenantAId],
    )
  ).rows;
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
    INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
      ('platform-admin','Admin','admin@example.test','x','student',0),
      ('tenant-admin-a','TAdminA','ta@example.test','x','student',0),
      ('mentor-a','MentorA','ma@example.test','x','mentor',0),
      ('student-a','StudentA','sa@example.test','x','student',0),
      ('tenant-admin-b','TAdminB','tb@example.test','x','student',0),
      ('mentor-b','MentorB','mb@example.test','x','mentor',0),
      ('student-b','StudentB','sb@example.test','x','student',0);
  `);
  await db.query("INSERT INTO aristo.platform_admins(user_id) VALUES ('platform-admin')");
  for (const [tenantId, userId, role] of [
    [tenantAId, "tenant-admin-a", "TENANT_ADMIN"],
    [tenantAId, "mentor-a", "MENTOR"],
    [tenantAId, "student-a", "STUDENT"],
    [tenantBId, "tenant-admin-b", "TENANT_ADMIN"],
    [tenantBId, "mentor-b", "MENTOR"],
    [tenantBId, "student-b", "STUDENT"],
  ])
    await db.query(
      "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES ($1,$2,$3)",
      [tenantId, userId, role],
    );
  for (const [tenantId, orgId, userId, role] of [
    [tenantAId, orgAId, "mentor-a", "MENTOR"],
    [tenantAId, orgAId, "student-a", "STUDENT"],
    [tenantBId, orgBId, "mentor-b", "MENTOR"],
    [tenantBId, orgBId, "student-b", "STUDENT"],
  ])
    await db.query(
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES ($1,$2,$3,$4)",
      [tenantId, orgId, userId, role],
    );
  // The SELECT case for a mentor depends on an existing mentor_students
  // link (can_access_business_row), not just shared organization.
  await db.query(
    "INSERT INTO aristo.mentor_students(mentor_id,student_id) VALUES ('mentor-a','student-a')",
  );
  await db.query(
    "INSERT INTO aristo.mentor_students(mentor_id,student_id) VALUES ('mentor-b','student-b')",
  );

  async function asActor(userId, sql, params = []) {
    await db.exec("BEGIN");
    await db.exec("SET ROLE aristo_app");
    try {
      await db.query("SELECT set_config('app.user_id', $1, true)", [
        userId ?? "",
      ]);
      const result = await db.query(sql, params);
      await db.exec("COMMIT");
      return result;
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    } finally {
      await db.exec("RESET ROLE");
    }
  }
  const asOwner = (sql, params = []) => db.query(sql, params);

  return { tenantAId, orgAId, tenantBId, orgBId, asActor, asOwner };
}

// items, questions and study_sessions share the exact same insert shape
// (id, user_id, data, tenant_id, organization_id) — this single function
// runs the full battery of checks against whichever one it's given.
async function checkIdBasedBusinessTable(table) {
  const db = new PGlite();
  try {
    const { tenantAId, orgAId, tenantBId, orgBId, asActor, asOwner } =
      await buildTwoTenantFixture(db);

    // student-a creates their own row.
    await asActor(
      "student-a",
      `INSERT INTO aristo.${table}(id,user_id,data,tenant_id,organization_id) VALUES('row-a','student-a','{}',$1,$2)`,
      [tenantAId, orgAId],
    );
    assert.equal(
      (await asOwner(`SELECT 1 FROM aristo.${table} WHERE id='row-a'`)).rows.length,
      1,
      "linha deveria ter sido criada",
    );

    // self, platform admin, tenant admin (same tenant) and the linked
    // mentor can all SELECT it; unrelated tenant B accounts cannot.
    assert.equal(
      (await asActor("student-a", `SELECT 1 FROM aristo.${table} WHERE id='row-a'`)).rows.length,
      1,
    );
    assert.equal(
      (await asActor("mentor-a", `SELECT 1 FROM aristo.${table} WHERE id='row-a'`)).rows.length,
      1,
      "mentor-a tem vínculo mentor_students com student-a",
    );
    assert.equal(
      (await asActor("tenant-admin-a", `SELECT 1 FROM aristo.${table} WHERE id='row-a'`)).rows.length,
      1,
    );
    assert.equal(
      (await asActor("platform-admin", `SELECT 1 FROM aristo.${table} WHERE id='row-a'`)).rows.length,
      1,
    );
    for (const outsider of ["mentor-b", "tenant-admin-b", "student-b"])
      assert.equal(
        (await asActor(outsider, `SELECT 1 FROM aristo.${table} WHERE id='row-a'`)).rows.length,
        0,
        `${outsider} não deve ver a linha do Tenant A`,
      );

    // Nobody but the owner or a platform admin can write it — not even
    // the linked mentor or the tenant admin: confirmed against the real
    // app code that no such write path exists today.
    for (const nonOwner of ["mentor-a", "tenant-admin-a", "mentor-b", "tenant-admin-b", "student-b"]) {
      assert.equal(
        (await asActor(nonOwner, `UPDATE aristo.${table} SET data='{"x":1}' WHERE id='row-a'`)).rowCount,
        0,
        `${nonOwner} não deve conseguir atualizar a linha de outro usuário`,
      );
      assert.equal(
        (await asActor(nonOwner, `DELETE FROM aristo.${table} WHERE id='row-a'`)).rowCount,
        0,
        `${nonOwner} não deve conseguir deletar a linha de outro usuário`,
      );
    }
    await assert.rejects(
      asActor(
        "mentor-a",
        `INSERT INTO aristo.${table}(id,user_id,data,tenant_id,organization_id) VALUES('row-mentor','student-a','{}',$1,$2)`,
        [tenantAId, orgAId],
      ),
      /row-level security/i,
      "mentor não pode inserir dado em nome de um aluno",
    );

    // The owner themselves can update and delete their own row.
    await asActor("student-a", `UPDATE aristo.${table} SET data='{"updated":true}' WHERE id='row-a'`);
    assert.deepEqual(
      JSON.parse((await asOwner(`SELECT data FROM aristo.${table} WHERE id='row-a'`)).rows[0].data),
      { updated: true },
    );
    await asActor("student-a", `DELETE FROM aristo.${table} WHERE id='row-a'`);
    assert.equal(
      (await asOwner(`SELECT 1 FROM aristo.${table} WHERE id='row-a'`)).rows.length,
      0,
    );

    // Platform admin can write anyone's row.
    await asActor(
      "platform-admin",
      `INSERT INTO aristo.${table}(id,user_id,data,tenant_id,organization_id) VALUES('row-admin','student-b','{}',$1,$2)`,
      [tenantBId, orgBId],
    );
    await asActor("platform-admin", `DELETE FROM aristo.${table} WHERE id='row-admin'`);
    assert.equal(
      (await asOwner(`SELECT 1 FROM aristo.${table} WHERE id='row-admin'`)).rows.length,
      0,
    );

    // No actor context: zero visibility, no error.
    assert.equal((await asActor(null, `SELECT * FROM aristo.${table}`)).rows.length, 0);
  } finally {
    await db.close();
  }
}

test("Fase 3B RLS batch 3: items enforces isolation as aristo_app", () =>
  checkIdBasedBusinessTable("items"));
test("Fase 3B RLS batch 3: questions enforces isolation as aristo_app", () =>
  checkIdBasedBusinessTable("questions"));
test("Fase 3B RLS batch 3: study_sessions enforces isolation as aristo_app", () =>
  checkIdBasedBusinessTable("study_sessions"));

test("Fase 3B RLS batch 3: plans enforces isolation as aristo_app", async () => {
  // plans has no standalone id column — PRIMARY KEY(user_id, date).
  const db = new PGlite();
  try {
    const { tenantAId, orgAId, asActor, asOwner } =
      await buildTwoTenantFixture(db);
    const planDate = "2026-01-01";

    await asActor(
      "student-a",
      "INSERT INTO aristo.plans(user_id,date,data,tenant_id,organization_id) VALUES('student-a',$1,'{}',$2,$3)",
      [planDate, tenantAId, orgAId],
    );

    assert.equal(
      (await asActor("student-a", "SELECT 1 FROM aristo.plans WHERE user_id='student-a' AND date=$1", [planDate])).rows.length,
      1,
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT 1 FROM aristo.plans WHERE user_id='student-a' AND date=$1", [planDate])).rows.length,
      1,
    );
    assert.equal(
      (await asActor("tenant-admin-a", "SELECT 1 FROM aristo.plans WHERE user_id='student-a' AND date=$1", [planDate])).rows.length,
      1,
    );
    for (const outsider of ["mentor-b", "tenant-admin-b", "student-b"])
      assert.equal(
        (await asActor(outsider, "SELECT 1 FROM aristo.plans WHERE user_id='student-a' AND date=$1", [planDate])).rows.length,
        0,
      );

    for (const nonOwner of ["mentor-a", "tenant-admin-a", "mentor-b", "student-b"]) {
      assert.equal(
        (
          await asActor(
            nonOwner,
            "UPDATE aristo.plans SET data='{\"x\":1}' WHERE user_id='student-a' AND date=$1",
            [planDate],
          )
        ).rowCount,
        0,
        `${nonOwner} não deve conseguir atualizar o plano de outro usuário`,
      );
    }

    await asActor(
      "student-a",
      "UPDATE aristo.plans SET data='{\"updated\":true}' WHERE user_id='student-a' AND date=$1",
      [planDate],
    );
    assert.deepEqual(
      JSON.parse((await asOwner("SELECT data FROM aristo.plans WHERE user_id='student-a' AND date=$1", [planDate])).rows[0].data),
      { updated: true },
    );
    await asActor("student-a", "DELETE FROM aristo.plans WHERE user_id='student-a' AND date=$1", [planDate]);
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.plans WHERE user_id='student-a' AND date=$1", [planDate])).rows.length,
      0,
    );

    assert.equal((await asActor(null, "SELECT * FROM aristo.plans")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 3: records enforces isolation as aristo_app", async () => {
  // records has PRIMARY KEY(user_id, item_id, date) and a composite FK to
  // items(user_id, id) — needs an owning item to exist first.
  const db = new PGlite();
  try {
    const { tenantAId, orgAId, asActor, asOwner } =
      await buildTwoTenantFixture(db);
    const date = "2026-01-01";

    await asActor(
      "student-a",
      "INSERT INTO aristo.items(id,user_id,data,tenant_id,organization_id) VALUES('item-a','student-a','{}',$1,$2)",
      [tenantAId, orgAId],
    );
    await asActor(
      "student-a",
      "INSERT INTO aristo.records(user_id,item_id,date,target,tenant_id,organization_id) VALUES('student-a','item-a',$1,1,$2,$3)",
      [date, tenantAId, orgAId],
    );

    const whereClause = "user_id='student-a' AND item_id='item-a' AND date=$1";
    assert.equal(
      (await asActor("student-a", `SELECT 1 FROM aristo.records WHERE ${whereClause}`, [date])).rows.length,
      1,
    );
    assert.equal(
      (await asActor("mentor-a", `SELECT 1 FROM aristo.records WHERE ${whereClause}`, [date])).rows.length,
      1,
    );
    assert.equal(
      (await asActor("tenant-admin-a", `SELECT 1 FROM aristo.records WHERE ${whereClause}`, [date])).rows.length,
      1,
    );
    for (const outsider of ["mentor-b", "tenant-admin-b", "student-b"])
      assert.equal(
        (await asActor(outsider, `SELECT 1 FROM aristo.records WHERE ${whereClause}`, [date])).rows.length,
        0,
      );

    for (const nonOwner of ["mentor-a", "tenant-admin-a", "student-b"]) {
      assert.equal(
        (
          await asActor(nonOwner, `UPDATE aristo.records SET value=99 WHERE ${whereClause}`, [date])
        ).rowCount,
        0,
        `${nonOwner} não deve conseguir atualizar o record de outro usuário`,
      );
    }

    await asActor("student-a", `UPDATE aristo.records SET value=1, done=1 WHERE ${whereClause}`, [date]);
    assert.equal(
      (await asOwner(`SELECT done FROM aristo.records WHERE ${whereClause}`, [date])).rows[0].done,
      1,
    );
    await asActor("student-a", `DELETE FROM aristo.records WHERE ${whereClause}`, [date]);
    assert.equal(
      (await asOwner(`SELECT 1 FROM aristo.records WHERE ${whereClause}`, [date])).rows.length,
      0,
    );

    assert.equal((await asActor(null, "SELECT * FROM aristo.records")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 4: tenant_members enforces isolation as aristo_app", async () => {
  const db = new PGlite();
  try {
    const { tenantAId, tenantBId, asActor, asOwner } = await buildTwoTenantFixture(db);

    // Confirmed real path: a brand-new user self-inserts as STUDENT.
    await db.exec(
      "INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES('fresh-student','Fresh','fresh@example.test','x','student',0)",
    );
    await asActor(
      "fresh-student",
      "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES($1,'fresh-student','STUDENT')",
      [tenantAId],
    );
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.tenant_members WHERE tenant_id=$1 AND user_id='fresh-student'", [tenantAId])).rows.length,
      1,
    );

    // No confirmed path self-inserts as MENTOR or TENANT_ADMIN — must be
    // rejected regardless of the requester's own users.role.
    await assert.rejects(
      asActor(
        "fresh-student",
        "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES($1,'fresh-student','TENANT_ADMIN') ON CONFLICT (tenant_id,user_id) DO NOTHING",
        [tenantBId],
      ),
      /row-level security/i,
    );
    await assert.rejects(
      asActor(
        "mentor-a",
        "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES($1,'mentor-a','MENTOR') ON CONFLICT (tenant_id,user_id) DO UPDATE SET role='MENTOR'",
        [tenantBId],
      ),
      /row-level security/i,
      "mentor-a já é MENTOR no Tenant A, mas isso não autoriza se auto-inserir como MENTOR no Tenant B",
    );

    // Self, platform admin and this tenant's admin can all see the row;
    // Tenant B's own admin cannot.
    assert.equal(
      (await asActor("fresh-student", "SELECT 1 FROM aristo.tenant_members WHERE user_id='fresh-student'")).rows.length,
      1,
    );
    assert.equal(
      (await asActor("tenant-admin-a", "SELECT 1 FROM aristo.tenant_members WHERE user_id='fresh-student'")).rows.length,
      1,
    );
    assert.equal(
      (await asActor("tenant-admin-b", "SELECT 1 FROM aristo.tenant_members WHERE user_id='fresh-student'")).rows.length,
      0,
    );

    // Only admin can update/delete membership rows.
    assert.equal(
      (
        await asActor(
          "mentor-a",
          "UPDATE aristo.tenant_members SET role='TENANT_ADMIN' WHERE user_id='fresh-student'",
        )
      ).rowCount,
      0,
    );
    await asActor(
      "tenant-admin-a",
      "UPDATE aristo.tenant_members SET status='suspended' WHERE user_id='fresh-student'",
    );
    assert.equal(
      (await asOwner("SELECT status FROM aristo.tenant_members WHERE user_id='fresh-student'")).rows[0].status,
      "suspended",
    );
    assert.equal(
      (await asActor("mentor-a", "DELETE FROM aristo.tenant_members WHERE user_id='fresh-student'")).rowCount,
      0,
    );
    await asActor("platform-admin", "DELETE FROM aristo.tenant_members WHERE user_id='fresh-student'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.tenant_members WHERE user_id='fresh-student'")).rows.length,
      0,
    );

    assert.equal((await asActor(null, "SELECT * FROM aristo.tenant_members")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 4: organization_members enforces isolation, self-promotion is rejected", async () => {
  const db = new PGlite();
  try {
    const { tenantAId, orgAId, asActor, asOwner } =
      await buildTwoTenantFixture(db);

    await db.exec(`
      INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES
        ('fresh-student','Fresh','fresh@example.test','x','student',0),
        ('fresh-mentor','FreshMentor','freshmentor@example.test','x','mentor',0);
    `);
    await db.query(
      "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES($1,'fresh-student','STUDENT'),($1,'fresh-mentor','MENTOR')",
      [tenantAId],
    );

    // --- The critical negative case: a plain student cannot self-insert
    // as MENTOR in any organization, including one they're not even a
    // member of.
    await assert.rejects(
      asActor(
        "fresh-student",
        "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES($1,$2,'fresh-student','MENTOR')",
        [tenantAId, orgAId],
      ),
      /row-level security/i,
      "aluno comum não pode se auto-inserir como MENTOR",
    );
    await assert.rejects(
      asActor(
        "student-a",
        "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES($1,$2,'student-a','MENTOR') ON CONFLICT (organization_id,user_id) DO UPDATE SET member_role='MENTOR'",
        [tenantAId, orgAId],
      ),
      /row-level security/i,
      "student-a já é membro de orgA como STUDENT — mesmo assim não pode virar MENTOR sozinho",
    );

    // --- The legitimate path: a user whose users.role already says
    // 'mentor' CAN self-insert as MENTOR (this is exactly what addStudent's
    // very first call does, before is_organization_mentor() could ever be
    // true for them).
    await asActor(
      "fresh-mentor",
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES($1,$2,'fresh-mentor','MENTOR')",
      [tenantAId, orgAId],
    );
    assert.equal(
      (await asOwner("SELECT member_role FROM aristo.organization_members WHERE user_id='fresh-mentor'")).rows[0].member_role,
      "MENTOR",
    );

    // --- Re-upsert of the mentor's own row (ensureOrganizationMembership's
    // ON CONFLICT DO UPDATE, exercised on a mentor's *second* addStudent
    // call) must keep working.
    await asActor(
      "fresh-mentor",
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role,status) VALUES($1,$2,'fresh-mentor','MENTOR','active') ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active', updated_at=now()",
      [tenantAId, orgAId],
    );
    // --- Explicit idempotent MENTOR→MENTOR UPDATE of the mentor's own row
    // (the ON CONFLICT case above never actually names member_role in its
    // SET list, so it doesn't by itself prove this — a real UPDATE that
    // writes the same value back must pass both USING and WITH CHECK via
    // the same self-clause used for INSERT).
    await asActor(
      "fresh-mentor",
      "UPDATE aristo.organization_members SET member_role='MENTOR' WHERE user_id='fresh-mentor'",
    );
    assert.equal(
      (await asOwner("SELECT member_role FROM aristo.organization_members WHERE user_id='fresh-mentor'")).rows[0].member_role,
      "MENTOR",
      "mentor real deve poder reafirmar a própria linha como MENTOR (upsert idempotente)",
    );

    // --- A mentor inserting a STUDENT row on someone else's behalf
    // (addStudent) is the confirmed real path.
    await asActor(
      "fresh-mentor",
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES($1,$2,'fresh-student','STUDENT')",
      [tenantAId, orgAId],
    );
    assert.equal(
      (await asOwner("SELECT member_role FROM aristo.organization_members WHERE user_id='fresh-student'")).rows[0].member_role,
      "STUDENT",
    );

    // --- But that same mentor cannot use UPDATE to promote that student
    // to MENTOR — the other half of the escalation guard. USING *does*
    // see this row (fresh-mentor is this org's mentor, and the row is
    // currently STUDENT), so the rejection is a thrown WITH CHECK
    // violation, not a silent 0-row update — unlike the student's own
    // attempt below, which USING excludes outright.
    await assert.rejects(
      asActor(
        "fresh-mentor",
        "UPDATE aristo.organization_members SET member_role='MENTOR' WHERE user_id='fresh-student'",
      ),
      /row-level security/i,
      "mentor não pode promover o próprio aluno a MENTOR via UPDATE",
    );
    // --- Nor can the student promote themselves via UPDATE — here USING
    // itself excludes the row (fresh-student is not this org's mentor and
    // has no self-as-MENTOR clause while member_role is still STUDENT),
    // so this one *is* a silent 0-row update, not a rejection.
    assert.equal(
      (
        await asActor(
          "fresh-student",
          "UPDATE aristo.organization_members SET member_role='MENTOR' WHERE user_id='fresh-student'",
        )
      ).rowCount,
      0,
      "aluno não pode se autopromover via UPDATE",
    );
    // The legitimate mentor operation on a student's row (suspend) still works.
    await asActor(
      "fresh-mentor",
      "UPDATE aristo.organization_members SET status='suspended' WHERE user_id='fresh-student'",
    );
    assert.equal(
      (await asOwner("SELECT status FROM aristo.organization_members WHERE user_id='fresh-student'")).rows[0].status,
      "suspended",
    );

    // --- Visibility: platform admin, tenant admin and the org's own
    // mentor all see the roster; Tenant B's accounts see nothing.
    assert.equal(
      (await asActor("tenant-admin-a", "SELECT 1 FROM aristo.organization_members WHERE user_id='fresh-student'")).rows.length,
      1,
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT 1 FROM aristo.organization_members WHERE user_id='fresh-student'")).rows.length,
      1,
      "mentor-a é mentor da mesma organização (Turma Inicial)",
    );
    for (const outsider of ["mentor-b", "tenant-admin-b", "student-b"])
      assert.equal(
        (await asActor(outsider, "SELECT 1 FROM aristo.organization_members WHERE user_id='fresh-student'")).rows.length,
        0,
      );

    // --- No confirmed DELETE path — admin only.
    assert.equal(
      (await asActor("mentor-a", "DELETE FROM aristo.organization_members WHERE user_id='fresh-student'")).rowCount,
      0,
    );
    await asActor("platform-admin", "DELETE FROM aristo.organization_members WHERE user_id='fresh-student'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.organization_members WHERE user_id='fresh-student'")).rows.length,
      0,
    );

    assert.equal((await asActor(null, "SELECT * FROM aristo.organization_members")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("Fase 4A (bug found by the first real CI run): a mentor promoted by hand (users.role only, organization_members left STUDENT) can still complete their own upsert to MENTOR", async () => {
  const db = new PGlite();
  try {
    const { tenantAId, orgAId, asActor, asOwner } =
      await buildTwoTenantFixture(db);

    // Exactly what a normal registration produces (every account gets a
    // STUDENT row), then exactly what scripts/set-mentor.mjs does — an
    // owner-level UPDATE of users.role ONLY, never touching
    // organization_members (confirmed by reading that script). No app code
    // and no aristo_app statement is involved in producing this state; it is
    // the pre-existing condition the bug needs, built directly as the owner.
    await db.exec(`
      INSERT INTO aristo.users(id,name,email,password,role,created_at)
        VALUES ('stale-mentor','Stale','stale@example.test','x','student',0);
    `);
    await db.query(
      "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES($1,'stale-mentor','STUDENT')",
      [tenantAId],
    );
    await db.query(
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role,status) VALUES($1,$2,'stale-mentor','STUDENT','active')",
      [tenantAId, orgAId],
    );
    await db.exec("UPDATE aristo.users SET role='mentor' WHERE id='stale-mentor'"); // scripts/set-mentor.mjs, as the owner

    // This is ensureOrganizationMembership()'s exact statement (src/server/
    // identity.ts), which addStudent()'s first call runs for the mentor's own
    // row. Before the fix, USING's self-clause required the PRE-update row to
    // already be member_role='MENTOR' — it is still 'STUDENT' here — so
    // neither USING branch matched and this raised "row-level security
    // policy" instead of upgrading the row, exactly the failure the review's
    // real CI run hit on the unrelated "mentor-a" fixture account.
    const upsert =
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET member_role=excluded.member_role, status='active', updated_at=now()";
    await asActor("stale-mentor", upsert, [tenantAId, orgAId, "stale-mentor", "MENTOR"]);
    assert.equal(
      (await asOwner("SELECT member_role, status FROM aristo.organization_members WHERE user_id='stale-mentor'")).rows[0].member_role,
      "MENTOR",
      "o próprio upsert do mentor deve promover a linha, mesmo partindo de STUDENT",
    );

    // The account can now do what a real mentor does next: add a student —
    // the actual scenario the CI run's fixture ("mentor-a") failed on.
    await asActor(
      "stale-mentor",
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES($1,$2,'student-a','STUDENT') ON CONFLICT(organization_id,user_id) DO UPDATE SET member_role='STUDENT', status='active', updated_at=now()",
      [tenantAId, orgAId],
    );

    // The escalation guard this branch relies on (has_mentor_role, i.e.
    // users.role='mentor') is untouched: a plain student in the exact same
    // starting shape still cannot self-upsert to MENTOR.
    await db.exec(`
      INSERT INTO aristo.users(id,name,email,password,role,created_at)
        VALUES ('still-student','Still','still@example.test','x','student',0);
    `);
    await db.query(
      "INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES($1,'still-student','STUDENT')",
      [tenantAId],
    );
    await db.query(
      "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role,status) VALUES($1,$2,'still-student','STUDENT','active')",
      [tenantAId, orgAId],
    );
    await assert.rejects(
      asActor("still-student", upsert, [tenantAId, orgAId, "still-student", "MENTOR"]),
      /row-level security/i,
      "aluno sem users.role='mentor' continua sem conseguir virar MENTOR por essa via",
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 5: users enforces self-only visibility/writability, role/email are column-locked", async () => {
  const db = new PGlite();
  try {
    const { asActor, asOwner } = await buildTwoTenantFixture(db);

    // --- SELECT: self and platform admin only. A colleague under the same
    // mentor (mentor-a/student-a) still cannot see another user's row
    // directly — that visibility is only ever granted through the narrow
    // functions below, never through the users table itself.
    assert.equal(
      (await asActor("student-a", "SELECT 1 FROM aristo.users WHERE id='student-a'")).rows.length,
      1,
    );
    assert.equal(
      (await asActor("platform-admin", "SELECT 1 FROM aristo.users WHERE id='student-a'")).rows.length,
      1,
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT password FROM aristo.users WHERE id='student-a'")).rows.length,
      0,
      "mentor-a não pode ler a linha de student-a diretamente, nem sequer a coluna password",
    );
    assert.equal(
      (await asActor("student-b", "SELECT 1 FROM aristo.users WHERE id='student-a'")).rows.length,
      0,
    );

    // --- INSERT: self only (registration's own pattern) or platform admin.
    await asActor(
      "fresh-user",
      "INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES('fresh-user','Fresh','fresh-user@example.test','x','student',0)",
    );
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.users WHERE id='fresh-user'")).rows.length,
      1,
    );
    await assert.rejects(
      asActor(
        "mentor-a",
        "INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES('another-user','Another','another@example.test','x','student',0)",
      ),
      /row-level security/i,
      "mentor-a não pode inserir uma linha de users em nome de outro id",
    );

    // --- UPDATE column grant: name/avatar/password are the only columns
    // aristo_app was ever granted UPDATE on — role/email are refused
    // outright, before RLS is even consulted, regardless of who's asking
    // (including platform admin, which never got the column grant either).
    await asActor("student-a", "UPDATE aristo.users SET name='Nova Sofia' WHERE id='student-a'");
    assert.equal(
      (await asOwner("SELECT name FROM aristo.users WHERE id='student-a'")).rows[0].name,
      "Nova Sofia",
    );
    await assert.rejects(
      asActor("student-a", "UPDATE aristo.users SET role='mentor' WHERE id='student-a'"),
      /permission denied/i,
      "auto-alteração de role deve ser recusada pelo GRANT por coluna, não pela RLS",
    );
    await assert.rejects(
      asActor("student-a", "UPDATE aristo.users SET email='new@example.test' WHERE id='student-a'"),
      /permission denied/i,
    );
    await assert.rejects(
      asActor("platform-admin", "UPDATE aristo.users SET role='mentor' WHERE id='student-a'"),
      /permission denied/i,
      "nem platform_admin tem o GRANT de role/email via aristo_app — precisa da conexão postgres",
    );

    // --- UPDATE row scope: only self or platform admin, never another
    // user, even for the granted columns.
    assert.equal(
      (
        await asActor("mentor-a", "UPDATE aristo.users SET name='Hackeado' WHERE id='student-a'")
      ).rowCount,
      0,
      "mentor-a não pode alterar o nome de student-a",
    );
    await asActor("platform-admin", "UPDATE aristo.users SET avatar='novo.png' WHERE id='student-a'");
    assert.equal(
      (await asOwner("SELECT avatar FROM aristo.users WHERE id='student-a'")).rows[0].avatar,
      "novo.png",
    );

    // --- DELETE: platform admin only.
    assert.equal(
      (await asActor("student-a", "DELETE FROM aristo.users WHERE id='student-a'")).rowCount,
      0,
      "ninguém se autoexclui",
    );
    await asActor("platform-admin", "DELETE FROM aristo.users WHERE id='fresh-user'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.users WHERE id='fresh-user'")).rows.length,
      0,
    );

    assert.equal((await asActor(null, "SELECT * FROM aristo.users")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 5: resolve_session_user resolves a valid session without an actor, and only that", async () => {
  const db = new PGlite();
  try {
    const { asActor, asOwner } = await buildTwoTenantFixture(db);
    const now = Date.now();
    await asOwner(
      "INSERT INTO aristo.sessions(token,user_id,expires) VALUES('hashed-token-a','student-a',$1)",
      [now + 1_000_000],
    );
    await asOwner(
      "INSERT INTO aristo.sessions(token,user_id,expires) VALUES('hashed-token-expired','student-a',$1)",
      [now - 1_000],
    );

    // No actor context at all (this is the whole point — login/session
    // resolution happens *before* an actor exists) still resolves the
    // session, because the function's security comes from the exact token
    // match, not from current_user_id().
    const resolved = await asActor(
      null,
      "SELECT * FROM aristo.resolve_session_user($1,$2)",
      ["hashed-token-a", now],
    );
    assert.equal(resolved.rows.length, 1);
    assert.equal(resolved.rows[0].id, "student-a");
    assert.equal(resolved.rows[0].name, "StudentA");
    assert.equal("password" in resolved.rows[0], false, "a função nunca retorna a coluna password");

    // Expired session: no row, no error.
    assert.equal(
      (
        await asActor(null, "SELECT * FROM aristo.resolve_session_user($1,$2)", [
          "hashed-token-expired",
          now,
        ])
      ).rows.length,
      0,
    );
    // Wrong token: no row, no error.
    assert.equal(
      (
        await asActor(null, "SELECT * FROM aristo.resolve_session_user($1,$2)", [
          "no-such-token",
          now,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 5: get_mentor_roster and get_linked_student never expose password, and only to the mentor themselves", async () => {
  const db = new PGlite();
  try {
    const { asActor } = await buildTwoTenantFixture(db);

    // mentor-a's roster is exactly student-a (the fixture's mentor_students
    // link), never anything from Tenant B.
    const roster = await asActor(
      "mentor-a",
      "SELECT * FROM aristo.get_mentor_roster($1)",
      ["mentor-a"],
    );
    assert.deepEqual(
      roster.rows.map((r) => r.id),
      ["student-a"],
    );
    assert.equal("password" in roster.rows[0], false);

    // Passing someone else's id as p_mentor_id doesn't work — the function
    // checks it against current_user_id() itself, regardless of what the
    // caller passes in.
    assert.equal(
      (await asActor("mentor-b", "SELECT * FROM aristo.get_mentor_roster($1)", ["mentor-a"])).rows
        .length,
      0,
      "mentor-b não pode ler o roster de mentor-a passando o id de outra pessoa",
    );
    assert.equal(
      (await asActor(null, "SELECT * FROM aristo.get_mentor_roster($1)", ["mentor-a"])).rows.length,
      0,
      "sem contexto de ator, a função não retorna nada",
    );

    // get_linked_student: mentor-a and student-a are linked.
    const linked = await asActor(
      "mentor-a",
      "SELECT * FROM aristo.get_linked_student($1,$2)",
      ["mentor-a", "student-a"],
    );
    assert.equal(linked.rows.length, 1);
    assert.equal(linked.rows[0].name, "StudentA");
    assert.equal("password" in linked.rows[0], false);

    // mentor-a and student-b are not linked.
    assert.equal(
      (
        await asActor("mentor-a", "SELECT * FROM aristo.get_linked_student($1,$2)", [
          "mentor-a",
          "student-b",
        ])
      ).rows.length,
      0,
      "mentor-a não tem vínculo mentor_students com student-b",
    );
    // mentor-b impersonating mentor-a (passing mentor-a's id as
    // p_mentor_id while actually being mentor-b) does not work either.
    assert.equal(
      (
        await asActor("mentor-b", "SELECT * FROM aristo.get_linked_student($1,$2)", [
          "mentor-a",
          "student-a",
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 5: get_mentor_ranking returns only id/name/xp for siblings under the same mentor", async () => {
  const db = new PGlite();
  try {
    const { asActor } = await buildTwoTenantFixture(db);

    // student-a's ranking includes themselves (they share mentor-a with
    // themselves, trivially) and never a Tenant B student.
    const ranking = await asActor(
      "student-a",
      "SELECT * FROM aristo.get_mentor_ranking($1)",
      ["student-a"],
    );
    assert.deepEqual(
      ranking.rows.map((r) => r.id),
      ["student-a"],
    );
    assert.equal(Number(ranking.rows[0].xp), 0);
    assert.equal("password" in ranking.rows[0], false);
    assert.equal("email" in ranking.rows[0], false);

    // requesting_user_id must match current_user_id(): mentor-a cannot
    // fetch student-a's ranking by passing student-a's id while acting as
    // themselves.
    assert.equal(
      (
        await asActor("mentor-a", "SELECT * FROM aristo.get_mentor_ranking($1)", ["student-a"])
      ).rows.length,
      0,
    );
    // No actor context: empty, no error.
    assert.equal(
      (await asActor(null, "SELECT * FROM aristo.get_mentor_ranking($1)", ["student-a"])).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 6: sessions and password_resets work as token-possession exceptions", async () => {
  const db = new PGlite();
  try {
    const { asActor, asOwner } = await buildTwoTenantFixture(db);
    const now = Date.now();

    // --- sessions INSERT: always self, matching createSession()'s
    // setActor(userId) right before the INSERT.
    await asActor(
      "student-a",
      "INSERT INTO aristo.sessions(token,user_id,expires) VALUES('tok-student-a','student-a',$1)",
      [now + 1_000_000],
    );
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.sessions WHERE token='tok-student-a'")).rows.length,
      1,
    );
    await assert.rejects(
      asActor(
        "mentor-a",
        "INSERT INTO aristo.sessions(token,user_id,expires) VALUES('tok-forged','student-a',$1)",
        [now + 1_000_000],
      ),
      /row-level security/i,
      "mentor-a não pode criar uma sessão em nome de student-a",
    );

    // --- sessions SELECT: USING(true) — the row itself carries no secret
    // beyond the token value, and nothing in the app does a raw SELECT
    // against this table anymore (batch 5 routed the one that used to
    // exist through resolve_session_user()); this just confirms the table
    // doesn't refuse a read outright regardless of actor.
    assert.equal(
      (await asActor("student-b", "SELECT 1 FROM aristo.sessions WHERE token='tok-student-a'"))
        .rows.length,
      1,
    );
    assert.equal(
      (await asActor(null, "SELECT 1 FROM aristo.sessions WHERE token='tok-student-a'")).rows
        .length,
      1,
    );

    // --- sessions DELETE: USING(true) covers both the app's self-scoped
    // deletes (logout, change-password) and its no-actor sweeps (expired
    // cleanup) uniformly. Seed an expired row and delete it with no actor
    // at all, exactly like auth.ts's cleanup does.
    await asOwner(
      "INSERT INTO aristo.sessions(token,user_id,expires) VALUES('tok-expired','student-a',$1)",
      [now - 1_000],
    );
    await asActor(null, "DELETE FROM aristo.sessions WHERE expires < $1", [now]);
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.sessions WHERE token='tok-expired'")).rows.length,
      0,
    );
    // logout()'s own delete: no actor, exact token.
    await asActor(null, "DELETE FROM aristo.sessions WHERE token='tok-student-a'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.sessions WHERE token='tok-student-a'")).rows.length,
      0,
    );

    // --- sessions UPDATE: no confirmed path — admin-only default.
    await asOwner(
      "INSERT INTO aristo.sessions(token,user_id,expires) VALUES('tok-2','student-a',$1)",
      [now + 1_000_000],
    );
    assert.equal(
      (
        await asActor("student-a", "UPDATE aristo.sessions SET expires=$1 WHERE token='tok-2'", [
          now + 2_000_000,
        ])
      ).rowCount,
      0,
      "nenhum caminho real faz UPDATE em sessions — nem o dono da sessão",
    );
    await asActor("platform-admin", "UPDATE aristo.sessions SET expires=$1 WHERE token='tok-2'", [
      now + 2_000_000,
    ]);
    assert.equal(
      Number((await asOwner("SELECT expires FROM aristo.sessions WHERE token='tok-2'")).rows[0].expires),
      now + 2_000_000,
    );

    // --- password_resets INSERT: WITH CHECK(true), not self — the app's
    // only INSERT (recovery/route.ts's "request" branch) runs with no
    // actor at all, since the requester was never authenticated as the
    // account being reset.
    await asActor(
      null,
      "INSERT INTO aristo.password_resets(token,user_id,expires) VALUES('reset-student-a','student-a',$1)",
      [now + 1_000_000],
    );
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.password_resets WHERE token='reset-student-a'")).rows
        .length,
      1,
    );

    // --- password_resets SELECT: USING(true) — recovery/route.ts's token
    // verification runs before any actor exists.
    assert.equal(
      (
        await asActor(null, "SELECT user_id FROM aristo.password_resets WHERE token=$1", [
          "reset-student-a",
        ])
      ).rows[0].user_id,
      "student-a",
    );

    // --- password_resets DELETE: USING(true) — both the no-actor sweep
    // (expired rows, or the insert-then-rollback-on-email-failure path)
    // and the reset-confirm's own actor-scoped consume need to work.
    await asOwner(
      "INSERT INTO aristo.password_resets(token,user_id,expires) VALUES('reset-expired','student-a',$1)",
      [now - 1_000],
    );
    await asActor(null, "DELETE FROM aristo.password_resets WHERE expires < $1", [now]);
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.password_resets WHERE token='reset-expired'")).rows
        .length,
      0,
    );
    await asActor("student-a", "DELETE FROM aristo.password_resets WHERE token='reset-student-a'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.password_resets WHERE token='reset-student-a'")).rows
        .length,
      0,
    );

    // --- password_resets UPDATE: no confirmed path — admin-only default.
    await asOwner(
      "INSERT INTO aristo.password_resets(token,user_id,expires) VALUES('reset-2','student-a',$1)",
      [now + 1_000_000],
    );
    assert.equal(
      (
        await asActor(
          "student-a",
          "UPDATE aristo.password_resets SET expires=$1 WHERE token='reset-2'",
          [now + 2_000_000],
        )
      ).rowCount,
      0,
    );
    await asActor(
      "platform-admin",
      "UPDATE aristo.password_resets SET expires=$1 WHERE token='reset-2'",
      [now + 2_000_000],
    );
    assert.equal(
      Number(
        (await asOwner("SELECT expires FROM aristo.password_resets WHERE token='reset-2'")).rows[0]
          .expires,
      ),
      now + 2_000_000,
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 7: mentor_students enforces mentor-scoped access, student_has_any_mentor_link sees across mentors", async () => {
  const db = new PGlite();
  try {
    const { asActor, asOwner } = await buildTwoTenantFixture(db);

    // --- SELECT: mentor_id = self only — no student-side raw read exists
    // in the app, so none is granted.
    assert.equal(
      (await asActor("mentor-a", "SELECT 1 FROM aristo.mentor_students WHERE mentor_id='mentor-a' AND student_id='student-a'"))
        .rows.length,
      1,
    );
    assert.equal(
      (await asActor("student-a", "SELECT 1 FROM aristo.mentor_students WHERE student_id='student-a'"))
        .rows.length,
      0,
      "não existe leitura direta pelo lado do aluno na aplicação",
    );
    assert.equal(
      (await asActor("mentor-b", "SELECT 1 FROM aristo.mentor_students WHERE mentor_id='mentor-a'"))
        .rows.length,
      0,
    );
    assert.equal(
      (await asActor("platform-admin", "SELECT 1 FROM aristo.mentor_students WHERE mentor_id='mentor-a'"))
        .rows.length,
      1,
    );

    // --- INSERT: mentor_id = self only (addStudent's own pattern).
    await db.exec(
      "INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES('fresh-student-2','Fresh2','fresh2@example.test','x','student',0)",
    );
    await asActor(
      "mentor-a",
      "INSERT INTO aristo.mentor_students(mentor_id,student_id) VALUES('mentor-a','fresh-student-2')",
    );
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.mentor_students WHERE mentor_id='mentor-a' AND student_id='fresh-student-2'"))
        .rows.length,
      1,
    );
    await assert.rejects(
      asActor(
        "mentor-b",
        "INSERT INTO aristo.mentor_students(mentor_id,student_id) VALUES('mentor-a','fresh-student-2') ON CONFLICT DO NOTHING",
      ),
      /row-level security/i,
      "mentor-b não pode criar um vínculo em nome de mentor-a",
    );

    // --- DELETE: mentor_id = self only — mentor-b can't touch mentor-a's
    // link (silent 0 rows, USING excludes it outright), mentor-a can
    // delete their own.
    assert.equal(
      (await asActor("mentor-b", "DELETE FROM aristo.mentor_students WHERE mentor_id='mentor-a' AND student_id='fresh-student-2'"))
        .rowCount,
      0,
    );
    await asActor("mentor-a", "DELETE FROM aristo.mentor_students WHERE mentor_id='mentor-a' AND student_id='fresh-student-2'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.mentor_students WHERE mentor_id='mentor-a' AND student_id='fresh-student-2'"))
        .rows.length,
      0,
    );

    // --- UPDATE: no real path — admin-only default.
    assert.equal(
      (await asActor("mentor-a", "UPDATE aristo.mentor_students SET student_id='student-a' WHERE mentor_id='mentor-a' AND student_id='student-a'"))
        .rowCount,
      0,
    );

    // --- student_has_any_mentor_link: the actual bug this batch fixes.
    // student-a starts linked only to mentor-a (fixture). Link a second
    // mentor, then remove mentor-a's own link — the function must still
    // see mentor-b's link, which a mentor_id-scoped SELECT policy alone
    // could never show mentor-a.
    await asOwner("INSERT INTO aristo.mentor_students(mentor_id,student_id) VALUES('mentor-b','student-a')");
    await asActor("mentor-a", "DELETE FROM aristo.mentor_students WHERE mentor_id='mentor-a' AND student_id='student-a'");
    assert.equal(
      (await asActor(null, "SELECT aristo.student_has_any_mentor_link($1) AS linked", ["student-a"]))
        .rows[0].linked,
      true,
      "student-a ainda está vinculado a mentor-b",
    );
    await asActor("mentor-b", "DELETE FROM aristo.mentor_students WHERE mentor_id='mentor-b' AND student_id='student-a'");
    assert.equal(
      (await asActor(null, "SELECT aristo.student_has_any_mentor_link($1) AS linked", ["student-a"]))
        .rows[0].linked,
      false,
      "nenhum mentor mais vinculado a student-a",
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 7: rate_limits is fully open to aristo_app (no per-user data, pre-auth writes)", async () => {
  const db = new PGlite();
  try {
    const { asActor } = await buildTwoTenantFixture(db);
    const now = Date.now();

    // No actor at all — exactly how http.ts's limit() runs pre-auth.
    const first = await asActor(
      null,
      "INSERT INTO aristo.rate_limits(key,hits,until) VALUES('k1',1,$1) ON CONFLICT(key) DO UPDATE SET hits=aristo.rate_limits.hits+1 RETURNING hits",
      [now + 60000],
    );
    assert.equal(Number(first.rows[0].hits), 1);
    // The real conflict-update path, still with no actor: this is the
    // reason UPDATE can't default to admin-only here.
    const second = await asActor(
      null,
      "INSERT INTO aristo.rate_limits(key,hits,until) VALUES('k1',1,$1) ON CONFLICT(key) DO UPDATE SET hits=aristo.rate_limits.hits+1 RETURNING hits",
      [now + 60000],
    );
    assert.equal(Number(second.rows[0].hits), 2);

    await asActor(
      null,
      "INSERT INTO aristo.rate_limits(key,hits,until) VALUES('k-expired',1,$1)",
      [now - 1000],
    );
    await asActor(null, "DELETE FROM aristo.rate_limits WHERE until < $1", [now]);
    assert.equal(
      (await asActor(null, "SELECT 1 FROM aristo.rate_limits WHERE key='k-expired'")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 7: demo_batches (self SELECT, admin-only writes) and audit_logs (admin-only everything)", async () => {
  const db = new PGlite();
  try {
    const { asActor, asOwner } = await buildTwoTenantFixture(db);

    // --- demo_batches
    await asOwner("INSERT INTO aristo.demo_batches(user_id,created_at) VALUES('student-a', now())");
    assert.equal(
      (await asActor("student-a", "SELECT 1 FROM aristo.demo_batches WHERE user_id='student-a'")).rows
        .length,
      1,
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT 1 FROM aristo.demo_batches WHERE user_id='student-a'")).rows
        .length,
      0,
    );
    assert.equal(
      (await asActor("platform-admin", "SELECT 1 FROM aristo.demo_batches WHERE user_id='student-a'"))
        .rows.length,
      1,
    );
    await assert.rejects(
      asActor(
        "student-b",
        "INSERT INTO aristo.demo_batches(user_id,created_at) VALUES('student-b', now())",
      ),
      /row-level security/i,
      "nenhum caminho confirmado insere demo_batches via aristo_app — nem o próprio usuário",
    );
    await asActor(
      "platform-admin",
      "INSERT INTO aristo.demo_batches(user_id,created_at) VALUES('student-b', now())",
    );
    assert.equal(
      (await asActor("student-b", "DELETE FROM aristo.demo_batches WHERE user_id='student-b'"))
        .rowCount,
      0,
    );
    await asActor("platform-admin", "DELETE FROM aristo.demo_batches WHERE user_id='student-b'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.demo_batches WHERE user_id='student-b'")).rows.length,
      0,
    );

    // --- audit_logs: admin-only on every command, nothing else touches it.
    await asOwner(
      "INSERT INTO aristo.audit_logs(action,entity_type) VALUES('test.action','test')",
    );
    assert.equal(
      (await asActor("platform-admin", "SELECT 1 FROM aristo.audit_logs WHERE action='test.action'"))
        .rows.length,
      1,
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT 1 FROM aristo.audit_logs WHERE action='test.action'")).rows
        .length,
      0,
    );
    await assert.rejects(
      asActor(
        "mentor-a",
        "INSERT INTO aristo.audit_logs(action,entity_type) VALUES('forged','test')",
      ),
      /row-level security/i,
    );
    assert.equal(
      (
        await asActor("mentor-a", "DELETE FROM aristo.audit_logs WHERE action='test.action'")
      ).rowCount,
      0,
    );
    await asActor("platform-admin", "DELETE FROM aristo.audit_logs WHERE action='test.action'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.audit_logs WHERE action='test.action'")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("Fase 3B RLS batch 8: profiles enforces self-only access (the table missed by batches 1-7)", async () => {
  const db = new PGlite();
  try {
    const { asActor, asOwner } = await buildTwoTenantFixture(db);

    // --- INSERT: self only (createProfile's own pattern — the actor is
    // always the freshly minted user's own id).
    await asActor(
      "student-a",
      "INSERT INTO aristo.profiles(user_id,full_name,avatar_url) VALUES('student-a','Sofia A',NULL)",
    );
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.profiles WHERE user_id='student-a'")).rows.length,
      1,
    );
    await assert.rejects(
      asActor(
        "mentor-a",
        "INSERT INTO aristo.profiles(user_id,full_name,avatar_url) VALUES('student-b','Forged',NULL)",
      ),
      /row-level security/i,
      "mentor-a não pode criar o profile de outro usuário",
    );

    // --- SELECT: self and platform admin only.
    assert.equal(
      (await asActor("student-a", "SELECT 1 FROM aristo.profiles WHERE user_id='student-a'")).rows
        .length,
      1,
    );
    assert.equal(
      (await asActor("mentor-a", "SELECT 1 FROM aristo.profiles WHERE user_id='student-a'")).rows
        .length,
      0,
    );
    assert.equal(
      (await asActor("platform-admin", "SELECT 1 FROM aristo.profiles WHERE user_id='student-a'"))
        .rows.length,
      1,
    );

    // --- UPDATE: self only (updateProfileName/updateProfileAvatar's own
    // pattern).
    await asActor(
      "student-a",
      "UPDATE aristo.profiles SET full_name='Sofia Updated' WHERE user_id='student-a'",
    );
    assert.equal(
      (await asOwner("SELECT full_name FROM aristo.profiles WHERE user_id='student-a'")).rows[0]
        .full_name,
      "Sofia Updated",
    );
    assert.equal(
      (
        await asActor(
          "mentor-a",
          "UPDATE aristo.profiles SET full_name='Hackeado' WHERE user_id='student-a'",
        )
      ).rowCount,
      0,
    );

    // --- DELETE: admin-only (no confirmed path — rows are only ever
    // removed via ON DELETE CASCADE from users, run as the owning role).
    assert.equal(
      (await asActor("student-a", "DELETE FROM aristo.profiles WHERE user_id='student-a'")).rowCount,
      0,
    );
    await asActor("platform-admin", "DELETE FROM aristo.profiles WHERE user_id='student-a'");
    assert.equal(
      (await asOwner("SELECT 1 FROM aristo.profiles WHERE user_id='student-a'")).rows.length,
      0,
    );

    assert.equal((await asActor(null, "SELECT * FROM aristo.profiles")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("Fase 3B pre-cutover: the real registration sequence completes end-to-end as aristo_app", async () => {
  const db = new PGlite();
  try {
    const { tenantAId, orgAId, asActor } = await buildTwoTenantFixture(db);

    // A genuinely fresh actor cannot see Tenant 01/its default organization
    // via a plain SELECT — this is the actual bug found by a real smoke
    // test against Supabase: tenants_select requires is_platform_admin() OR
    // is_tenant_member(id), which a brand-new registrant is neither yet.
    // The first version of this test used tenantAId/orgAId directly
    // (already known from the fixture's own owner-level setup) and so
    // never exercised this lookup at all — which is exactly how this bug
    // went unnoticed by this suite in the first place.
    assert.equal(
      (await asActor("fresh-registrant", "SELECT 1 FROM aristo.tenants WHERE slug='mentoria-coelho'"))
        .rows.length,
      0,
      "um registrante recém-criado não deveria conseguir ver a linha de tenants diretamente",
    );

    // Mirrors auth/route.ts's register handler + identity.ts's
    // createProfile/syncTenantMembership/ensureOrganizationMembership,
    // statement for statement, in one transaction, as aristo_app — not
    // just each policy in isolation. This is the exact sequence that would
    // have broken outright post-cutover with profiles left unpoliced (batch
    // 8) or with tenants/organizations undiscoverable by a fresh actor
    // (this fix): a single failing statement here rolls back the whole
    // account.
    await db.exec("BEGIN");
    await db.exec("SET ROLE aristo_app");
    try {
      await db.query("SELECT set_config('app.user_id', 'fresh-registrant', true)");
      await db.query(
        "INSERT INTO aristo.users(id,name,email,password,created_at) VALUES('fresh-registrant','Fresh Registrant','fresh-registrant@example.test','x',0)",
      );
      await db.query(
        "INSERT INTO aristo.profiles(user_id,full_name,avatar_url) VALUES('fresh-registrant','Fresh Registrant',NULL)",
      );
      // Discovers tenant_id via aristo.default_organization(), exactly
      // like identity.ts's syncTenantMembership() now does — not via a
      // pre-known id from the fixture.
      const { rows: [{ tenant_id: discoveredTenantId, organization_id: discoveredOrgId }] } =
        await db.query("SELECT * FROM aristo.default_organization()");
      assert.equal(discoveredTenantId, tenantAId);
      assert.equal(discoveredOrgId, orgAId);
      await db.query(
        `INSERT INTO aristo.tenant_members(tenant_id,user_id,role) VALUES($1,'fresh-registrant','STUDENT')
         ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role, updated_at=now()`,
        [discoveredTenantId],
      );
      await db.query(
        `INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role,status)
         VALUES($1,$2,'fresh-registrant','STUDENT','active')
         ON CONFLICT(organization_id,user_id) DO UPDATE
           SET member_role=excluded.member_role, status='active', updated_at=now()`,
        [discoveredTenantId, discoveredOrgId],
      );
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    } finally {
      await db.exec("RESET ROLE");
    }

    // Confirm every row actually landed (a silently-skipped INSERT would
    // have made this look like a pass without one).
    assert.equal(
      (await db.query("SELECT 1 FROM aristo.users WHERE id='fresh-registrant'")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("SELECT 1 FROM aristo.profiles WHERE user_id='fresh-registrant'")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT role FROM aristo.tenant_members WHERE tenant_id=$1 AND user_id='fresh-registrant'",
          [tenantAId],
        )
      ).rows[0].role,
      "STUDENT",
    );
    assert.equal(
      (
        await db.query(
          "SELECT member_role,status FROM aristo.organization_members WHERE organization_id=$1 AND user_id='fresh-registrant'",
          [orgAId],
        )
      ).rows[0].status,
      "active",
    );
  } finally {
    await db.close();
  }
});

test("Fase 4A: aristo.set_member_role() only works for platform_admin, keeps organization_members in sync", async () => {
  const db = new PGlite();
  try {
    const { asActor, asOwner } = await buildTwoTenantFixture(db);

    // A plain mentor (not platform_admin) cannot call this directly —
    // the gate is inside the function itself, not just hidden behind a
    // UI button. Postgres wraps the RAISE EXCEPTION as a generic server
    // error; the important thing is that it's rejected, not what shape.
    await assert.rejects(
      asActor("mentor-a", "SELECT aristo.set_member_role('student-b','mentor')"),
      /permission denied/i,
      "mentor-a não é platform_admin e não deve conseguir promover ninguém",
    );
    assert.equal(
      (await asOwner("SELECT role FROM aristo.users WHERE id='student-b'")).rows[0].role,
      "student",
      "student-b não deve ter sido promovido pela tentativa negada",
    );

    // platform-admin promotes student-a to mentor — both users.role and
    // organization_members.member_role must end up in sync.
    await asActor("platform-admin", "SELECT aristo.set_member_role('student-a','mentor')");
    assert.equal(
      (await asOwner("SELECT role FROM aristo.users WHERE id='student-a'")).rows[0].role,
      "mentor",
    );
    assert.equal(
      (
        await asOwner(
          "SELECT member_role FROM aristo.organization_members WHERE user_id='student-a'",
        )
      ).rows[0].member_role,
      "MENTOR",
    );

    // And back down again — demotion keeps both tables in sync too.
    await asActor("platform-admin", "SELECT aristo.set_member_role('student-a','student')");
    assert.equal(
      (await asOwner("SELECT role FROM aristo.users WHERE id='student-a'")).rows[0].role,
      "student",
    );
    assert.equal(
      (
        await asOwner(
          "SELECT member_role FROM aristo.organization_members WHERE user_id='student-a'",
        )
      ).rows[0].member_role,
      "STUDENT",
    );

    // Invalid role value is rejected outright, not silently ignored.
    await assert.rejects(
      asActor("platform-admin", "SELECT aristo.set_member_role('student-a','super_admin')"),
      /invalid role/i,
    );
  } finally {
    await db.close();
  }
});

test("Fase 4A: aristo.admin_reset_password() — platform_admin only, hash only, revokes sessions and recovery links, ACL closed to PUBLIC", async () => {
  const db = new PGlite();
  try {
    const { asActor, asOwner } = await buildTwoTenantFixture(db);
    const hashOf = (password) => {
      const salt = randomBytes(16).toString("hex");
      return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    };
    const matches = (password, stored) => {
      const [salt, value] = stored.split(":");
      return scryptSync(password, salt, 64).toString("hex") === value;
    };
    const next = hashOf("Senha-Temporaria-2026");

    for (const [token, user] of [
      ["tok-sa-1", "student-a"],
      ["tok-sa-2", "student-a"],
      ["tok-sb-1", "student-b"],
      ["tok-ma-1", "mentor-a"],
    ])
      await asOwner(
        "INSERT INTO aristo.sessions(token,user_id,expires) VALUES ($1,$2,9999999999999)",
        [token, user],
      );
    for (const [token, user] of [
      ["reset-sa", "student-a"],
      ["reset-sb", "student-b"],
    ])
      await asOwner(
        "INSERT INTO aristo.password_resets(token,user_id,expires) VALUES ($1,$2,9999999999999)",
        [token, user],
      );
    const count = async (table, user) =>
      Number(
        (
          await asOwner(
            `SELECT count(*) AS n FROM aristo.${table} WHERE user_id=$1`,
            [user],
          )
        ).rows[0].n,
      );
    const passwordOf = async (user) =>
      (await asOwner("SELECT password FROM aristo.users WHERE id=$1", [user]))
        .rows[0].password;
    const reset = (actor, target, hash) =>
      asActor(actor, "SELECT aristo.admin_reset_password($1,$2) AS changed", [
        target,
        hash,
      ]);

    // Nobody but a platform_admin: not the account itself, another student,
    // a mentor, a tenant admin, nor a request with no actor at all. The gate
    // is in the function, not just behind the button.
    for (const actor of [
      "student-a",
      "student-b",
      "mentor-a",
      "tenant-admin-a",
      "tenant-admin-b",
      null,
    ])
      await assert.rejects(
        reset(actor, "student-a", next),
        /permission denied/i,
        `${actor ?? "sem ator"} não pode redefinir senhas`,
      );
    assert.equal(await passwordOf("student-a"), "x", "senha intacta após tentativas negadas");
    assert.equal(await count("sessions", "student-a"), 2);
    assert.equal(await count("password_resets", "student-a"), 1);

    // A clear-text password (or anything that is not the app's scrypt
    // salt:key format) never gets stored, even from an admin.
    for (const bad of ["Senha-Temporaria-2026", "", "abc:def", next.toUpperCase()])
      await assert.rejects(
        reset("platform-admin", "student-a", bad),
        /invalid password hash/i,
        `hash inválido rejeitado: ${bad.slice(0, 12)}`,
      );
    await assert.rejects(
      asActor(
        "platform-admin",
        "SELECT aristo.admin_reset_password('student-a', NULL)",
      ),
      /invalid password hash/i,
    );
    assert.equal(await passwordOf("student-a"), "x");

    // The real thing: platform_admin resets student-a.
    assert.equal(
      (await reset("platform-admin", "student-a", next)).rows[0].changed,
      true,
    );
    assert.equal(await passwordOf("student-a"), next);
    // The login lookup (same function the app uses) now returns the new hash,
    // which verifies against the new password and no longer against the old.
    const login = (
      await asActor(null, "SELECT * FROM aristo.verify_login_credential($1)", [
        "sa@example.test",
      ])
    ).rows[0];
    assert.equal(login.id, "student-a");
    assert.equal(matches("Senha-Temporaria-2026", login.password), true);
    assert.equal(matches("x", login.password), false);
    // Live sessions and pending recovery links of that account are gone...
    assert.equal(await count("sessions", "student-a"), 0);
    assert.equal(await count("password_resets", "student-a"), 0);
    // ...and nobody else's are touched.
    assert.equal(await count("sessions", "student-b"), 1);
    assert.equal(await count("sessions", "mentor-a"), 1);
    assert.equal(await count("password_resets", "student-b"), 1);
    assert.equal(await passwordOf("student-b"), "x");
    assert.equal(await passwordOf("mentor-a"), "x");

    // An id that matches nobody is reported, not silently "successful", and
    // does not disturb anything.
    assert.equal(
      (await reset("platform-admin", "no-such-user", hashOf("Outra-Senha-2026"))).rows[0]
        .changed,
      false,
    );
    assert.equal(await count("sessions", "student-b"), 1);

    // ACL on the live catalog: SECURITY DEFINER with a pinned search_path,
    // executable by aristo_app, and not by PUBLIC.
    const fn = (
      await asOwner(
        `SELECT p.prosecdef, p.proconfig::text AS config, p.proacl::text AS acl,
                has_function_privilege('aristo_app', p.oid, 'EXECUTE') AS app_can
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='aristo' AND p.proname='admin_reset_password'`,
      )
    ).rows;
    assert.equal(fn.length, 1);
    assert.equal(fn[0].prosecdef, true);
    assert.match(fn[0].config, /search_path=aristo, pg_catalog/);
    assert.equal(fn[0].app_can, true);
    assert.match(fn[0].acl, /aristo_app=X\//);
    assert.doesNotMatch(
      fn[0].acl,
      /(^\{|,)"?=X\//,
      "PUBLIC não pode executar admin_reset_password",
    );
  } finally {
    await db.close();
  }
});

test("branding: the first tenant is renamed to Plataforma Coelho, slug untouched, re-runnable, never overwrites a custom name", async () => {
  const db = new PGlite();
  try {
    const files = readdirSync("supabase/migrations").sort();
    for (const file of files)
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const rename = readFileSync(
      "supabase/migrations/202609190022_rename_tenant_plataforma_coelho.sql",
      "utf8",
    );
    assert.ok(
      files.includes("202609190022_rename_tenant_plataforma_coelho.sql"),
    );
    const read = async () =>
      (
        await db.query(
          `SELECT t.name, t.slug, s.platform_name, s.logo_url
             FROM aristo.tenants t JOIN aristo.tenant_settings s ON s.tenant_id = t.id
            WHERE t.slug = 'mentoria-coelho'`,
        )
      ).rows;
    // After the whole chain: renamed in both places, slug and logo path intact.
    assert.deepEqual(await read(), [
      {
        name: "Plataforma Coelho",
        slug: "mentoria-coelho",
        platform_name: "Plataforma Coelho",
        logo_url: "/brand/coelho-mark.png",
      },
    ]);
    // Running it again changes nothing.
    await db.exec(rename);
    assert.equal((await read())[0].name, "Plataforma Coelho");
    // The logo path follows the renamed file (0023) and is not overwritten
    // when it was set by hand.
    const logoMigration = readFileSync(
      "supabase/migrations/202609190023_tenant_logo_coelho_mark.sql",
      "utf8",
    );
    assert.ok(files.includes("202609190023_tenant_logo_coelho_mark.sql"));
    await db.exec(logoMigration);
    assert.equal((await read())[0].logo_url, "/brand/coelho-mark.png");
    await db.exec(
      "UPDATE aristo.tenant_settings SET logo_url='/brand/personalizada.png'",
    );
    await db.exec(logoMigration);
    assert.equal((await read())[0].logo_url, "/brand/personalizada.png");
    await db.exec(
      "UPDATE aristo.tenant_settings SET logo_url='/brand/coelho-mark.png'",
    );
    // A name customised by hand is not overwritten.
    await db.exec(
      "UPDATE aristo.tenants SET name='Nome Personalizado' WHERE slug='mentoria-coelho'; UPDATE aristo.tenant_settings SET platform_name='Nome Personalizado'",
    );
    await db.exec(rename);
    assert.deepEqual(
      (await read()).map((r) => [r.name, r.platform_name]),
      [["Nome Personalizado", "Nome Personalizado"]],
    );
  } finally {
    await db.close();
  }
});

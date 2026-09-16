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
      ["Mentoria Coelho", "Tenant B"],
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
      ["Mentoria Coelho"],
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

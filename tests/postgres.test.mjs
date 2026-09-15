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
      "src/app/api/auth/route.ts",
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
    await db.exec(
      "INSERT INTO aristo.items(id,user_id,data) VALUES('i','a','{}')",
    );
    await assert.rejects(
      db.exec(
        "INSERT INTO aristo.records(user_id,item_id,date,target) VALUES('b','i','2026-09-15',1)",
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

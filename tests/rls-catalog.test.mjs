import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Generic security invariants over the WHOLE aristo schema, read from the Postgres
// catalog — no hard-coded list of functions or tables. A new function or table added
// by a future migration is checked automatically, and the build fails if it ships
// without the protections every existing one has.
//
// Why: Postgres grants EXECUTE on every new function to PUBLIC by default, which is
// exactly how migration 009's 13 functions went out open until 010 closed them. Until
// now only one function (admin_reset_password) had a test for that; the rest were
// checked by hand.
//
// Invariants:
//   functions  — never executable by PUBLIC; SECURITY DEFINER ones pin search_path
//   tables     — RLS enabled AND forced; a policy for each of SELECT/INSERT/UPDATE/
//                DELETE; no policy that applies to PUBLIC; not owned by the app role
//   app role   — aristo_app is not superuser, does not bypass RLS, cannot create
//                roles/databases, and cannot reach the migrations bookkeeping table
//   users      — aristo_app cannot UPDATE role or email (only name/avatar/password)

const APP_ROLE = "aristo_app";
const COMMANDS = { r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE" };

export async function auditCatalog(db) {
  const violations = [];

  const functions = (
    await db.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
             coalesce(p.proconfig::text, '') AS config,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'aristo' AND p.prokind = 'f'
       ORDER BY p.proname`)
  ).rows;
  for (const f of functions) {
    const name = `aristo.${f.proname}(${f.args})`;
    if (f.public_exec) violations.push(`function ${name} is executable by PUBLIC (missing REVOKE ... FROM PUBLIC)`);
    if (f.prosecdef && !/search_path=/.test(f.config)) violations.push(`function ${name} is SECURITY DEFINER without a pinned search_path`);
  }

  const appRole = (await db.query("SELECT oid, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1", [APP_ROLE])).rows[0];
  assert.ok(appRole, `role ${APP_ROLE} must exist`);
  if (appRole.rolsuper) violations.push(`${APP_ROLE} is a superuser`);
  if (appRole.rolbypassrls) violations.push(`${APP_ROLE} has BYPASSRLS`);
  if (appRole.rolcreaterole) violations.push(`${APP_ROLE} can create roles`);
  if (appRole.rolcreatedb) violations.push(`${APP_ROLE} can create databases`);

  const tables = (
    await db.query(`
      SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'aristo' AND c.relkind IN ('r', 'p') AND c.relname <> 'migrations'
       ORDER BY c.relname`)
  ).rows;
  for (const t of tables) {
    const name = `aristo.${t.relname}`;
    if (!t.relrowsecurity) violations.push(`table ${name}: row level security is not enabled`);
    if (!t.relforcerowsecurity) violations.push(`table ${name}: row level security is not FORCEd`);
    if (t.owner === APP_ROLE) violations.push(`table ${name} is owned by ${APP_ROLE} (an owner is not bound by policies unless forced, and could change them)`);
    const policies = (await db.query("SELECT polcmd, polroles FROM pg_policy WHERE polrelid = $1", [t.oid])).rows;
    if (!policies.length) violations.push(`table ${name} has no policy at all`);
    const covered = new Set(policies.map((p) => (p.polcmd === "*" ? "all" : COMMANDS[p.polcmd])));
    if (!covered.has("all"))
      for (const command of Object.values(COMMANDS)) if (!covered.has(command)) violations.push(`table ${name} has no ${command} policy (decide it explicitly, even if the answer is "nobody")`);
    if (policies.some((p) => p.polroles.includes(0) || p.polroles.includes("0") || p.polroles.includes(0n)))
      violations.push(`table ${name} has a policy that applies to PUBLIC`);
  }

  // scripts/migrate-postgres.mjs creates this table itself (it is not in any migration
  // file); the app role must never see it.
  const migrationsPrivileges = (
    await db.query(
      "SELECT to_regclass('aristo.migrations') IS NOT NULL AND (has_table_privilege($1, 'aristo.migrations', 'SELECT') OR has_table_privilege($1, 'aristo.migrations', 'INSERT') OR has_table_privilege($1, 'aristo.migrations', 'UPDATE') OR has_table_privilege($1, 'aristo.migrations', 'DELETE')) AS reachable",
      [APP_ROLE],
    )
  ).rows[0];
  if (migrationsPrivileges.reachable) violations.push(`${APP_ROLE} can reach aristo.migrations`);

  for (const column of ["role", "email"])
    if ((await db.query("SELECT has_column_privilege($1, 'aristo.users', $2, 'UPDATE') AS ok", [APP_ROLE, column])).rows[0].ok)
      violations.push(`${APP_ROLE} can UPDATE aristo.users.${column} (privilege changes must go through set_member_role)`);
  for (const column of ["name", "avatar", "password"])
    if (!(await db.query("SELECT has_column_privilege($1, 'aristo.users', $2, 'UPDATE') AS ok", [APP_ROLE, column])).rows[0].ok)
      violations.push(`${APP_ROLE} lost UPDATE on aristo.users.${column}`);

  return { violations, functions: functions.length, tables: tables.length };
}

async function migrated() {
  const db = new PGlite();
  // Same order as scripts/migrate-postgres.mjs: schema and the bookkeeping table
  // first, then the migration files. It matters: migration 008's ALTER DEFAULT
  // PRIVILEGES gives aristo_app DML on every table created AFTER it, so a
  // "migrations" table created later would (wrongly) be reachable by the app.
  await db.exec(`CREATE SCHEMA IF NOT EXISTS aristo;
    REVOKE ALL ON SCHEMA aristo FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS aristo.migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  for (const file of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  return db;
}

test("every function, table and grant in the aristo schema satisfies the security invariants", async () => {
  const db = await migrated();
  try {
    const { violations, functions, tables } = await auditCatalog(db);
    assert.deepEqual(violations, []);
    // not vacuous: it really walked the schema
    assert.ok(functions >= 20, `expected the aristo functions, saw ${functions}`);
    assert.ok(tables >= 18, `expected the aristo tables, saw ${tables}`);
  } finally {
    await db.close();
  }
});

test("the audit fails for each way a new object could ship unprotected (deliberate mutants)", async () => {
  const db = await migrated();
  try {
    await db.exec(`
      -- 1. a function nobody REVOKEd: PostgreSQL's default leaves it executable by PUBLIC
      CREATE FUNCTION aristo.mutant_open() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
      -- 2. SECURITY DEFINER without a pinned search_path (closed to PUBLIC, so only this rule fires)
      CREATE FUNCTION aristo.mutant_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      REVOKE EXECUTE ON FUNCTION aristo.mutant_definer() FROM PUBLIC;
      -- 3. a table with no RLS at all
      CREATE TABLE aristo.mutant_no_rls (id int);
      -- 4. RLS enabled but not FORCEd, with all four policies
      CREATE TABLE aristo.mutant_not_forced (id int);
      ALTER TABLE aristo.mutant_not_forced ENABLE ROW LEVEL SECURITY;
      CREATE POLICY p_s ON aristo.mutant_not_forced FOR SELECT TO aristo_app USING (true);
      CREATE POLICY p_i ON aristo.mutant_not_forced FOR INSERT TO aristo_app WITH CHECK (true);
      CREATE POLICY p_u ON aristo.mutant_not_forced FOR UPDATE TO aristo_app USING (true);
      CREATE POLICY p_d ON aristo.mutant_not_forced FOR DELETE TO aristo_app USING (true);
      -- 5. a policy that applies to PUBLIC
      CREATE TABLE aristo.mutant_public_policy (id int);
      ALTER TABLE aristo.mutant_public_policy ENABLE ROW LEVEL SECURITY;
      ALTER TABLE aristo.mutant_public_policy FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_all ON aristo.mutant_public_policy FOR ALL USING (true);
      -- 6. forced RLS, but the DELETE decision was never made
      CREATE TABLE aristo.mutant_missing_delete (id int);
      ALTER TABLE aristo.mutant_missing_delete ENABLE ROW LEVEL SECURITY;
      ALTER TABLE aristo.mutant_missing_delete FORCE ROW LEVEL SECURITY;
      CREATE POLICY p_s ON aristo.mutant_missing_delete FOR SELECT TO aristo_app USING (true);
      CREATE POLICY p_i ON aristo.mutant_missing_delete FOR INSERT TO aristo_app WITH CHECK (true);
      CREATE POLICY p_u ON aristo.mutant_missing_delete FOR UPDATE TO aristo_app USING (true);
      -- 7. the app role is handed too much
      ALTER ROLE aristo_app BYPASSRLS;
      GRANT UPDATE (role, email) ON aristo.users TO aristo_app;
      GRANT SELECT ON aristo.migrations TO aristo_app;
    `);
    const { violations } = await auditCatalog(db);
    const text = violations.join("\n");
    const expected = [
      /mutant_open\(\) is executable by PUBLIC/,
      /mutant_definer\(\) is SECURITY DEFINER without a pinned search_path/,
      /aristo\.mutant_no_rls: row level security is not enabled/,
      /aristo\.mutant_no_rls has no policy at all/,
      /aristo\.mutant_not_forced: row level security is not FORCEd/,
      /aristo\.mutant_public_policy has a policy that applies to PUBLIC/,
      /aristo\.mutant_missing_delete has no DELETE policy/,
      /aristo_app has BYPASSRLS/,
      /aristo_app can UPDATE aristo\.users\.role/,
      /aristo_app can UPDATE aristo\.users\.email/,
      /aristo_app can reach aristo\.migrations/,
    ];
    for (const pattern of expected) assert.match(text, pattern);
    // and it did not cry wolf about the healthy objects
    assert.doesNotMatch(text, /aristo\.(users|sessions|items|tenants)\b.*(not enabled|no policy)/);
    assert.doesNotMatch(text, /function aristo\.(set_member_role|admin_reset_password)/);
  } finally {
    await db.close();
  }
});

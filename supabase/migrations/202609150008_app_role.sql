-- Fase 3B (part 1): a non-owner, non-BYPASSRLS role for the running app to
-- connect as. This is the actual precondition for RLS to have any effect
-- at all: the role the app has used so far (whatever DATABASE_URL points
-- at — "postgres" on Supabase) owns every table in this schema AND
-- typically carries the BYPASSRLS attribute, and BYPASSRLS overrides
-- policies and FORCE ROW LEVEL SECURITY unconditionally, for every table,
-- no exception. Policies written against the owning role would compile
-- and do nothing.
--
-- Created NOLOGIN on purpose: this migration carries no password. A
-- separate step (scripts/provision-app-role.mjs) sets one, so no secret
-- ever lands in a migration file or git history.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aristo_app') THEN
    EXECUTE 'CREATE ROLE aristo_app NOLOGIN';
  END IF;
END $$;

GRANT USAGE ON SCHEMA aristo TO aristo_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  aristo.users, aristo.sessions, aristo.items, aristo.records, aristo.plans,
  aristo.questions, aristo.study_sessions, aristo.mentor_students,
  aristo.rate_limits, aristo.demo_batches, aristo.password_resets,
  aristo.tenants, aristo.profiles, aristo.tenant_members,
  aristo.platform_admins, aristo.tenant_settings, aristo.audit_logs,
  aristo.organizations, aristo.organization_members
TO aristo_app;
-- Deliberately NOT granted: aristo.migrations — that table is exclusively
-- for the migration runner, which keeps connecting as the owning role.

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA aristo TO aristo_app;

-- Any table a future migration adds is granted to aristo_app automatically
-- — this list does not need to be kept in sync by hand from now on. The
-- migrations table itself predates this and is unaffected (DEFAULT
-- PRIVILEGES only applies going forward).
ALTER DEFAULT PRIVILEGES IN SCHEMA aristo
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aristo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA aristo
  GRANT USAGE, SELECT ON SEQUENCES TO aristo_app;

-- Belt-and-braces: aristo_app is not the table owner so this shouldn't be
-- load-bearing, but FORCE guards against a future migration accidentally
-- making it (or another non-BYPASSRLS role) the owner.
ALTER TABLE aristo.users               FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.mentor_students     FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.sessions            FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.items               FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.records             FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.plans               FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.questions           FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.study_sessions      FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.rate_limits         FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.demo_batches        FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.password_resets     FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.tenants             FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.profiles            FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.tenant_members      FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.platform_admins     FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.tenant_settings     FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.audit_logs          FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.organizations       FORCE ROW LEVEL SECURITY;
ALTER TABLE aristo.organization_members FORCE ROW LEVEL SECURITY;

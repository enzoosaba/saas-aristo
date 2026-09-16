-- Fase 3B (part 3): SQL-level authorization functions. Nothing in the app
-- calls these yet — additive and inert until the policies that use them
-- (a later migration) exist and aristo_app is actually the connecting
-- role. Safe to apply and test in isolation.
--
-- current_user_id() reads the per-transaction context set by
-- src/server/database.ts via set_config('app.user_id', ..., true) — SET
-- LOCAL semantics, so it can never leak across a pooled connection's
-- reuse by a different request (verified directly against Postgres before
-- this migration was written).
--
-- Every other function is SECURITY DEFINER, owned by the migration-running
-- role (the table owner, which bypasses RLS) rather than the caller
-- (aristo_app, which will not). Without this, a policy on
-- aristo.tenant_members that calls a function which itself queries
-- aristo.tenant_members would recurse into that same policy indefinitely
-- (Postgres errors with "stack depth limit exceeded") — the exact same
-- problem exists for aristo.organization_members and aristo.platform_admins.
-- SECURITY DEFINER breaks the cycle: the internal lookup runs as the owner
-- (no RLS applied to it), and only a computed boolean or id — never a raw
-- row — is returned to the caller. SET search_path is mandatory on every
-- SECURITY DEFINER function: without pinning it, a caller-controlled
-- search_path could shadow aristo.platform_admins with an attacker-created
-- table earlier in the path, and the function would silently query the
-- wrong table with the owner's elevated privilege.

CREATE OR REPLACE FUNCTION aristo.current_user_id() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;

-- Deliberately NOT SECURITY DEFINER: platform_admins' own RLS policy (a
-- later migration) only ever exposes "your own row", which is exactly what
-- this function's WHERE clause already asks for — so there is nothing to
-- recurse into. Kept SECURITY INVOKER as the safer default whenever
-- DEFINER isn't actually required to break a cycle.
CREATE OR REPLACE FUNCTION aristo.is_platform_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM aristo.platform_admins
    WHERE user_id = aristo.current_user_id() AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION aristo.current_tenant_id() RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT tenant_id FROM aristo.tenant_members
  WHERE user_id = aristo.current_user_id() AND status = 'active'
  ORDER BY joined_at ASC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION aristo.is_tenant_member(p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM aristo.tenant_members
    WHERE user_id = aristo.current_user_id() AND tenant_id = p_tenant_id
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION aristo.is_tenant_admin(p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM aristo.tenant_members
    WHERE user_id = aristo.current_user_id() AND tenant_id = p_tenant_id
      AND role = 'TENANT_ADMIN' AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION aristo.can_manage_tenant(p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT aristo.is_platform_admin() OR aristo.is_tenant_admin(p_tenant_id)
$$;

CREATE OR REPLACE FUNCTION aristo.is_organization_mentor(p_organization_id UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM aristo.organization_members
    WHERE user_id = aristo.current_user_id() AND organization_id = p_organization_id
      AND member_role = 'MENTOR' AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION aristo.is_organization_member(p_organization_id UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM aristo.organization_members
    WHERE user_id = aristo.current_user_id() AND organization_id = p_organization_id
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION aristo.can_manage_organization(p_organization_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT aristo.is_platform_admin()
    OR aristo.can_manage_tenant((SELECT tenant_id FROM aristo.organizations WHERE id = p_organization_id))
    OR aristo.is_organization_mentor(p_organization_id)
$$;

-- Mirrors src/server/authorization.ts's canAccessStudent exactly: self,
-- platform admin, this tenant's admin, or an existing mentor_students link
-- — and the student must actually belong to the named organization too.
CREATE OR REPLACE FUNCTION aristo.can_access_student(p_student_id TEXT, p_organization_id UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT p_student_id = aristo.current_user_id()
    OR aristo.is_platform_admin()
    OR aristo.can_manage_tenant((SELECT tenant_id FROM aristo.organizations WHERE id = p_organization_id))
    OR (
      EXISTS (SELECT 1 FROM aristo.mentor_students WHERE mentor_id = aristo.current_user_id() AND student_id = p_student_id)
      AND EXISTS (SELECT 1 FROM aristo.organization_members WHERE user_id = p_student_id AND organization_id = p_organization_id AND status = 'active')
    )
$$;

-- Shared by items/records/plans/questions/study_sessions' SELECT policies
-- (a later migration): the row's own user, platform admin, this tenant's
-- admin, or an organization mentor with a mentor_students link to that row's
-- user. Same shape as can_access_student, parameterized by tenant_id too
-- since these tables carry it directly (Fase 2A) rather than requiring a
-- join through aristo.organizations.
CREATE OR REPLACE FUNCTION aristo.can_access_business_row(p_user_id TEXT, p_tenant_id UUID, p_organization_id UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT p_user_id = aristo.current_user_id()
    OR aristo.is_platform_admin()
    OR aristo.is_tenant_admin(p_tenant_id)
    OR (
      aristo.is_organization_mentor(p_organization_id)
      AND EXISTS (SELECT 1 FROM aristo.mentor_students WHERE mentor_id = aristo.current_user_id() AND student_id = p_user_id)
    )
$$;

-- Narrow, purpose-built lookups for the three places that need to find a
-- user by email before any actor/relationship is established yet: login
-- (verify a password), password recovery (find who to email), and a
-- mentor adding a student (check eligibility before any mentor_students
-- link exists). A direct `SELECT ... FROM users WHERE email=?` would
-- otherwise need a users SELECT policy broad enough to defeat the point of
-- this phase (anyone could look up anyone by email). SECURITY DEFINER lets
-- these bypass row visibility for exactly the one row matched by an exact
-- email — not a broader grant.
CREATE OR REPLACE FUNCTION aristo.find_user_by_email(p_email TEXT)
RETURNS TABLE(id TEXT, role TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT id, role FROM aristo.users WHERE email = p_email
$$;

CREATE OR REPLACE FUNCTION aristo.verify_login_credential(p_email TEXT)
RETURNS TABLE(id TEXT, password TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT id, password FROM aristo.users WHERE email = p_email
$$;

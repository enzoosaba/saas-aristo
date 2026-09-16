-- Fase 3B part 5, batch 4: tenant_members and organization_members. The
-- most sensitive pair in the phase so far, because these two tables are
-- where a role is actually granted — a self-insert/self-update policy
-- written too loosely is a self-promotion path, not just an access-scope
-- leak. Confirmed against the real codebase before designing anything:
-- tenant_members' only writer is registration (self-insert, always
-- 'STUDENT' — never 'MENTOR'/'TENANT_ADMIN' via the app);
-- organization_members has three real writers — registration (self,
-- STUDENT), mentor.ts's addStudent (a mentor inserting both their own
-- MENTOR row and the student's STUDENT row), and removeStudent (a mentor
-- suspending the student's row).

-- Needed by the anti-escalation clauses below. Cannot inline
-- "EXISTS (SELECT 1 FROM aristo.users WHERE ...)" directly in a policy: it
-- would run as aristo_app, and aristo.users has RLS enabled with *zero*
-- policies until batch 5 — meaning that subquery would see nothing at all
-- right now and always evaluate false, silently defeating the very check
-- meant to allow the legitimate case. SECURITY DEFINER sidesteps this the
-- same way every other cross-table check in this phase does.
CREATE OR REPLACE FUNCTION aristo.has_mentor_role(p_user_id TEXT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM aristo.users WHERE id = p_user_id AND role = 'mentor')
$$;
-- Migration 010's comment claimed migration 008's schema-wide
-- ALTER DEFAULT PRIVILEGES ON FUNCTIONS would cover this automatically —
-- checked empirically while writing this migration, and that claim is
-- false: a brand-new function's proacl still comes out as
-- '{=X/postgres,postgres=X/postgres,aristo_app=X/postgres}' — the leading
-- "=X/postgres" entry (empty grantee) means PUBLIC still gets EXECUTE,
-- default privileges notwithstanding. Every new function needs its own
-- explicit REVOKE/GRANT, same as migration 010 did for the original 13 —
-- there is no working "set it once" shortcut for this in this environment.
REVOKE EXECUTE ON FUNCTION aristo.has_mentor_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.has_mentor_role(text) TO aristo_app;

-- tenant_members: only ever self-inserted as STUDENT by the app; anything
-- else (MENTOR/TENANT_ADMIN rows, or any UPDATE/DELETE) is administrative.
CREATE POLICY tenant_members_select ON aristo.tenant_members
  FOR SELECT TO aristo_app
  USING (
    aristo.is_platform_admin()
    OR aristo.can_manage_tenant(tenant_id)
    OR user_id = aristo.current_user_id()
  );
CREATE POLICY tenant_members_insert ON aristo.tenant_members
  FOR INSERT TO aristo_app
  WITH CHECK (
    aristo.can_manage_tenant(tenant_id)
    OR (user_id = aristo.current_user_id() AND role = 'STUDENT')
  );
-- No self-UPDATE clause: registration's ON CONFLICT DO UPDATE branch on
-- this table is unreachable in practice (a fresh registration always
-- mints a new id, so it can never collide with an existing row) — there is
-- no confirmed self-update path to cover, and adding one "to be safe"
-- would be exactly the kind of unrequested capability this project avoids.
CREATE POLICY tenant_members_update ON aristo.tenant_members
  FOR UPDATE TO aristo_app
  USING (aristo.can_manage_tenant(tenant_id))
  WITH CHECK (aristo.can_manage_tenant(tenant_id));
CREATE POLICY tenant_members_delete ON aristo.tenant_members
  FOR DELETE TO aristo_app
  USING (aristo.can_manage_tenant(tenant_id));

-- organization_members: SELECT extends to the organization's own mentor
-- (roster visibility — not yet read this way by any current route, but
-- explicitly requested for this batch and low-risk since it's read-only).
CREATE POLICY organization_members_select ON aristo.organization_members
  FOR SELECT TO aristo_app
  USING (
    aristo.is_platform_admin()
    OR aristo.can_manage_tenant(tenant_id)
    OR aristo.is_organization_mentor(organization_id)
    OR user_id = aristo.current_user_id()
  );

-- INSERT: admin; self-insert as STUDENT (registration); self-insert as
-- MENTOR *only* if users.role already says 'mentor' — never based on the
-- request alone, since that would let anyone self-promote; or a mentor of
-- this organization inserting a STUDENT row on someone else's behalf
-- (addStudent). The MENTOR self-clause is what lets a first-time mentor's
-- own row be created before is_organization_mentor() could ever be true
-- for them (chicken-and-egg on the very first addStudent call).
CREATE POLICY organization_members_insert ON aristo.organization_members
  FOR INSERT TO aristo_app
  WITH CHECK (
    aristo.is_platform_admin()
    OR aristo.can_manage_tenant(tenant_id)
    OR (user_id = aristo.current_user_id() AND member_role = 'STUDENT')
    OR (
      user_id = aristo.current_user_id() AND member_role = 'MENTOR'
      AND aristo.has_mentor_role(aristo.current_user_id())
    )
    OR (member_role = 'STUDENT' AND aristo.is_organization_mentor(organization_id))
  );

-- UPDATE: admin; a mentor of this organization updating a STUDENT row
-- (removeStudent's suspend, or ensureOrganizationMembership's upsert
-- reactivating one) — deliberately requires the row to *stay* STUDENT in
-- both the old and new version (USING sees the pre-update row, WITH CHECK
-- the proposed one), which is what actually blocks a student
-- self-promoting via UPDATE: user_id=self alone is *not* a valid clause
-- here on its own, unlike every other table in this phase, precisely
-- because that would let a STUDENT flip their own member_role to MENTOR.
-- The one self-case that *is* needed: a mentor's own row being re-upserted
-- (ensureOrganizationMembership is ON CONFLICT DO UPDATE, so a mentor's
-- second addStudent call updates their already-MENTOR row) — gated the
-- same way as the INSERT self-MENTOR case, on users.role already being
-- 'mentor', and only for a row that is (and stays) MENTOR, never a
-- transition from STUDENT.
CREATE POLICY organization_members_update ON aristo.organization_members
  FOR UPDATE TO aristo_app
  USING (
    aristo.is_platform_admin()
    OR aristo.can_manage_tenant(tenant_id)
    OR (member_role = 'STUDENT' AND aristo.is_organization_mentor(organization_id))
    OR (
      user_id = aristo.current_user_id() AND member_role = 'MENTOR'
      AND aristo.has_mentor_role(aristo.current_user_id())
    )
  )
  WITH CHECK (
    aristo.is_platform_admin()
    OR aristo.can_manage_tenant(tenant_id)
    OR (member_role = 'STUDENT' AND aristo.is_organization_mentor(organization_id))
    OR (
      user_id = aristo.current_user_id() AND member_role = 'MENTOR'
      AND aristo.has_mentor_role(aristo.current_user_id())
    )
  );

-- DELETE: no confirmed path removes an organization_members row today
-- (removeStudent only suspends via UPDATE) — administrative only.
CREATE POLICY organization_members_delete ON aristo.organization_members
  FOR DELETE TO aristo_app
  USING (aristo.is_platform_admin() OR aristo.can_manage_tenant(tenant_id));

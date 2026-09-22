-- Real bug found by the very first Postgres CI run ever executed for this
-- project (the checks job never got that far before now — a pnpm/CI ordering
-- issue fixed alongside this commit blocked it; see the pnpm-typegen fix).
-- The postgres job's own `postgres:17` service, actually authenticating as
-- aristo_app (unlike the local PGlite "plumbing smoke test", which cannot
-- authenticate and silently runs as owner), immediately hit:
--   ERROR: new row violates row-level security policy (USING expression)
--   for table "organization_members"
--   STATEMENT: INSERT INTO aristo.organization_members(...) VALUES(...)
--     ON CONFLICT(organization_id,user_id) DO UPDATE
--       SET member_role=excluded.member_role, status='active', updated_at=now()
-- on the delivery e2e's oldest scenario (a mentor's first addStudent() call),
-- unchanged since Fase 1C.
--
-- Root cause: every account gets a STUDENT organization_members row at
-- registration, always (src/app/api/auth/route.ts's ensureOrganizationMembership
-- call). Migration 202609160014's organization_members_update policy's
-- self-clause requires the *pre-update* row to already be `member_role =
-- 'MENTOR'` (checked in USING, which sees the OLD row) before letting someone
-- upsert their own row to MENTOR — but ensureOrganizationMembership(mentorId,
-- 'MENTOR')'s very first call for a mentor whose row is still STUDENT is an
-- INSERT that immediately conflicts on that pre-existing STUDENT row, so it is
-- the UPDATE policy that applies, not the INSERT policy (whose self-MENTOR
-- clause has no such restriction and does allow this). USING then evaluates
-- against a row that is *still* STUDENT — exactly the case the policy was
-- unintentionally built to reject, per its own comment ("only for a row that is
-- (and stays) MENTOR, never a transition from STUDENT") — a design choice, not
-- a typo, but one that assumed every mentor's own organization_members row
-- would already say MENTOR by the time they first call addStudent(). That is
-- true when promotion goes through aristo.set_member_role() (Fase 4A, keeps
-- both tables in sync) — but it is NOT true for scripts/set-mentor.mjs, the
-- promotion path that predates the admin panel and every mentor account
-- promoted through it before Fase 4A existed: it only ever set users.role,
-- via the owning role (bypassing RLS entirely, so it never hit this policy) —
-- confirmed by reading the script, not assumed.
--
-- (Checked directly against the live database: today's only two mentor
-- accounts, both already have a synced MENTOR organization_members row — this
-- is a real, confirmed defect, but not one currently blocking a specific
-- account. It is exactly the kind of gap that silently reappears the next
-- time an account is promoted by hand instead of through the admin panel.)
--
-- Fix: the actor's own authority to hold a MENTOR row comes from
-- has_mentor_role(current_user_id()) (users.role = 'mentor'), which is already
-- checked here and is unaffected by what organization_members currently says —
-- checking the *old* row's member_role in USING added nothing but this bug.
-- WITH CHECK still requires the *proposed* row to be member_role = 'MENTOR',
-- so this branch still only ever lets someone make their own row MENTOR
-- (never anything else) — the escalation guard is entirely in WITH CHECK,
-- matching the pattern the sibling STUDENT-side clause already uses (USING and
-- WITH CHECK both name member_role = 'STUDENT' there because that clause's row
-- never changes role in either direction).
DROP POLICY organization_members_update ON aristo.organization_members;
CREATE POLICY organization_members_update ON aristo.organization_members
  FOR UPDATE TO aristo_app
  USING (
    aristo.is_platform_admin()
    OR aristo.can_manage_tenant(tenant_id)
    OR (member_role = 'STUDENT' AND aristo.is_organization_mentor(organization_id))
    OR (
      user_id = aristo.current_user_id()
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

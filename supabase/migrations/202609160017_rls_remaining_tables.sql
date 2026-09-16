-- Fase 3B part 5, batch 7 (last RLS batch before part 6's provisioning
-- script and the part 7 cutover): mentor_students, rate_limits,
-- demo_batches, audit_logs. Design confirmed with the user after
-- re-grepping every real call site for all four tables — the same
-- discipline that already corrected the plan twice in batches 5 and 6.

-- mentor_students: only ever read/written filtered by the caller's own
-- mentor_id (mentor.ts's addStudent/removeStudent/dailySummary,
-- authorization.ts's canAccessStudent) — no student-side raw read exists,
-- so none is granted (same "don't grant what isn't proven to exist"
-- reasoning as batch 3's business-data tables).
--
-- One real cross-mentor case: identity.ts's
-- releaseOrganizationMembershipIfOrphaned does
-- `SELECT 1 FROM mentor_students WHERE student_id=?` with *no* mentor_id
-- filter, specifically to see whether *any* mentor (not just the one who
-- just removed their own link) still has this student — a self-scoped
-- SELECT policy would hide other mentors' links and cause a false
-- "orphaned" release, incorrectly suspending a student's organization
-- membership while they're still actively mentored by someone else.
-- Needs the same fix as batch 4's has_mentor_role: a SECURITY DEFINER
-- function, since this is a genuine "see across the whole table" check,
-- not an artifact of forgetting to scope a subquery.
CREATE OR REPLACE FUNCTION aristo.student_has_any_mentor_link(p_student_id TEXT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM aristo.mentor_students WHERE student_id = p_student_id)
$$;
REVOKE EXECUTE ON FUNCTION aristo.student_has_any_mentor_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.student_has_any_mentor_link(text) TO aristo_app;

CREATE POLICY mentor_students_select ON aristo.mentor_students
  FOR SELECT TO aristo_app
  USING (mentor_id = aristo.current_user_id() OR aristo.is_platform_admin());
CREATE POLICY mentor_students_insert ON aristo.mentor_students
  FOR INSERT TO aristo_app
  WITH CHECK (mentor_id = aristo.current_user_id() OR aristo.is_platform_admin());
-- No UPDATE path exists (the table is a bare junction — mentor_id and
-- student_id together are the whole row, nothing else to change) —
-- admin-only default, same convention as every other unconfirmed command
-- since batch 4.
CREATE POLICY mentor_students_update ON aristo.mentor_students
  FOR UPDATE TO aristo_app
  USING (aristo.is_platform_admin())
  WITH CHECK (aristo.is_platform_admin());
CREATE POLICY mentor_students_delete ON aristo.mentor_students
  FOR DELETE TO aristo_app
  USING (mentor_id = aristo.current_user_id() OR aristo.is_platform_admin());

-- rate_limits: no user_id column at all — a purely operational,
-- pre-auth anti-abuse table (http.ts's limit(), called from every
-- rate-limited route before any actor necessarily exists). USING/WITH
-- CHECK (true) throughout: unlike every other table in this phase, UPDATE
-- here is *not* an unconfirmed command defaulting to admin-only — it's a
-- real, constant write path (limit()'s `INSERT ... ON CONFLICT DO UPDATE
-- SET hits=hits+1` runs on essentially every request), so admin-only would
-- break rate limiting outright the moment aristo_app is the connecting
-- role.
CREATE POLICY rate_limits_select ON aristo.rate_limits
  FOR SELECT TO aristo_app USING (true);
CREATE POLICY rate_limits_insert ON aristo.rate_limits
  FOR INSERT TO aristo_app WITH CHECK (true);
CREATE POLICY rate_limits_update ON aristo.rate_limits
  FOR UPDATE TO aristo_app USING (true) WITH CHECK (true);
CREATE POLICY rate_limits_delete ON aristo.rate_limits
  FOR DELETE TO aristo_app USING (true);

-- demo_batches: the only real Postgres-path access is study.ts's
-- self-check (`SELECT user_id FROM demo_batches WHERE user_id=?`, "is this
-- a demo account"). The two places that ever INSERT a row
-- (scripts/seed-presentation.mjs, artifacts/refresh-demo-date.mjs) are
-- SQLite-only tooling (node:sqlite, not this app's Postgres path) — not a
-- confirmed aristo_app write path, so INSERT/UPDATE/DELETE default to
-- admin-only, same convention as always.
CREATE POLICY demo_batches_select ON aristo.demo_batches
  FOR SELECT TO aristo_app
  USING (user_id = aristo.current_user_id() OR aristo.is_platform_admin());
CREATE POLICY demo_batches_insert ON aristo.demo_batches
  FOR INSERT TO aristo_app WITH CHECK (aristo.is_platform_admin());
CREATE POLICY demo_batches_update ON aristo.demo_batches
  FOR UPDATE TO aristo_app
  USING (aristo.is_platform_admin())
  WITH CHECK (aristo.is_platform_admin());
CREATE POLICY demo_batches_delete ON aristo.demo_batches
  FOR DELETE TO aristo_app USING (aristo.is_platform_admin());

-- audit_logs: zero references anywhere in src/ or scripts/ today — the
-- only writer is the Fase 0B backfill migration itself, run as the owning
-- role (bypasses RLS already), and this table has been
-- `REVOKE ALL FROM PUBLIC` since its creation (migration 004). No
-- confirmed aristo_app read or write path exists at all — admin-only on
-- every command, matching the table's already-hardened posture rather
-- than inventing a broader one "for later".
CREATE POLICY audit_logs_select ON aristo.audit_logs
  FOR SELECT TO aristo_app USING (aristo.is_platform_admin());
CREATE POLICY audit_logs_insert ON aristo.audit_logs
  FOR INSERT TO aristo_app WITH CHECK (aristo.is_platform_admin());
CREATE POLICY audit_logs_update ON aristo.audit_logs
  FOR UPDATE TO aristo_app
  USING (aristo.is_platform_admin())
  WITH CHECK (aristo.is_platform_admin());
CREATE POLICY audit_logs_delete ON aristo.audit_logs
  FOR DELETE TO aristo_app USING (aristo.is_platform_admin());

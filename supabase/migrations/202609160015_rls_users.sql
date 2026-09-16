-- Fase 3B part 5, batch 5: users. The most sensitive table in the phase —
-- this is where a self-only visibility/writability policy is a genuine
-- self-escalation and password-exposure boundary, not just an
-- access-scope leak. Design confirmed with the user before writing this
-- file, including two gaps discovered by grepping the real call sites that
-- the original design (self SELECT, self UPDATE of name/avatar/password,
-- admin-only DELETE, a dedicated ranking function) did not anticipate:
--
-- 1. src/server/auth.ts's currentUser() resolves the session token to a
--    user by joining sessions+users *before* any actor is known (that's
--    what the query is for) — a self-only SELECT policy would make
--    current_user_id() null at that exact moment and break login/every
--    request. Fixed with aristo.resolve_session_user() below: the same
--    "narrow SECURITY DEFINER lookup keyed by an unforgeable value" shape
--    as find_user_by_email/verify_login_credential, keyed by the hashed
--    session token instead of email, returning only the columns the app
--    already selected (never password).
-- 2. src/server/mentor.ts's roster() and dailySummary() read a *linked
--    student's* name/email/avatar directly from users, via mentor_students
--    — a real, load-bearing read (the roster page), not self. Broadening
--    the SELECT policy's USING to cover "linked mentor" would repeat the
--    exact mistake already caught for the ranking feature: it would expose
--    the whole row, password included, to any SELECT a mentor could
--    construct. Fixed with aristo.get_mentor_roster() and
--    aristo.get_linked_student() below, both narrow SECURITY DEFINER
--    functions returning only (id, name, email, avatar).
--
-- A third gap was found and fixed at the application layer, not here:
-- src/app/api/auth/recovery/route.ts's reset-password confirm step
-- (token-possession flow, no session) never called setActor() — under the
-- self-only UPDATE policy below it would silently update 0 rows while
-- still reporting success. Fixed by calling setActor(row.user_id) once the
-- reset token is validated, mirroring the same pattern login and register
-- already use elsewhere in this phase.
--
-- Also note: the confirmed design's numbered list covered SELECT/UPDATE/
-- DELETE but not INSERT. Every other table policed in this phase got all
-- four commands (users already has FORCE ROW LEVEL SECURITY with zero
-- policies since part 1, so no INSERT policy means registration's
-- self-insert would be silently refused post-cutover) — added here as
-- table-completeness, not as a new capability: it only allows exactly what
-- src/app/api/auth/route.ts's register already does (self-insert, actor
-- set to the freshly minted id before the INSERT).

-- role/email/id/created_at are deliberately excluded from this grant: no
-- column-level privilege at all means UPDATE ... SET role=... (or email=...)
-- is refused for the *whole statement*, regardless of any RLS USING/WITH
-- CHECK clause, before RLS is even evaluated. This is what actually
-- prevents self-escalation via a role or email change; the RLS policy
-- below only needs to gate *which row*, not *which column*. Any future
-- admin action that must change role or email (e.g. promoting a user to
-- mentor) will need to run through the postgres connection, not aristo_app
-- — same as scripts/set-mentor.mjs already does today.
--
-- Verified empirically while writing this migration (mirroring the
-- ALTER-DEFAULT-PRIVILEGES lesson from batch 4): migration 008 already
-- granted table-wide UPDATE on all 19 tables, users included, to
-- aristo_app. Postgres privileges are additive, so a column-level GRANT
-- alone would have added to that blanket grant, not narrowed it — the
-- table-wide UPDATE would have silently continued to cover role/email too.
-- The REVOKE below is what actually makes the column list below it the
-- *only* UPDATE privilege aristo_app has on this table.
REVOKE UPDATE ON aristo.users FROM aristo_app;
GRANT UPDATE (name, avatar, password) ON aristo.users TO aristo_app;

CREATE POLICY users_select ON aristo.users
  FOR SELECT TO aristo_app
  USING (id = aristo.current_user_id() OR aristo.is_platform_admin());

CREATE POLICY users_insert ON aristo.users
  FOR INSERT TO aristo_app
  WITH CHECK (id = aristo.current_user_id() OR aristo.is_platform_admin());

-- No WITH CHECK beyond USING: the column grant above already makes any
-- attempt to change role/email fail outright, so there is no proposed-row
-- shape left to police here — matching the confirmed design.
CREATE POLICY users_update ON aristo.users
  FOR UPDATE TO aristo_app
  USING (id = aristo.current_user_id() OR aristo.is_platform_admin())
  WITH CHECK (id = aristo.current_user_id() OR aristo.is_platform_admin());

CREATE POLICY users_delete ON aristo.users
  FOR DELETE TO aristo_app
  USING (aristo.is_platform_admin());

-- Replaces the sessions+users join in src/server/auth.ts's currentUser(),
-- the one query in the whole app that necessarily runs before any actor
-- exists. Security comes from requiring the exact hashed token to match a
-- non-expired session row — the same guarantee the direct join already
-- had — not from current_user_id(), which is unavailable here by
-- construction. p_now is passed in rather than using now()/clock_timestamp()
-- to match the app's existing pattern of passing Date.now() explicitly
-- (see the query being replaced).
CREATE OR REPLACE FUNCTION aristo.resolve_session_user(p_token_hash TEXT, p_now BIGINT)
RETURNS TABLE(id TEXT, name TEXT, email TEXT, role TEXT, avatar TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT u.id, u.name, u.email, u.role, u.avatar
  FROM aristo.sessions s
  JOIN aristo.users u ON u.id = s.user_id
  WHERE s.token = p_token_hash AND s.expires > p_now
$$;
REVOKE EXECUTE ON FUNCTION aristo.resolve_session_user(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.resolve_session_user(text, bigint) TO aristo_app;

-- Replaces the users join in src/server/mentor.ts's roster(). The
-- p_mentor_id = current_user_id() clause is defense in depth, not a
-- behavior change: every call site passes the caller's own resolved id
-- (src/app/api/mentor/route.ts always calls roster(user.id)) — this just
-- makes that assumption enforced at the database layer too, the same way
-- can_access_student/can_access_business_row self-check in migration 009.
CREATE OR REPLACE FUNCTION aristo.get_mentor_roster(p_mentor_id TEXT)
RETURNS TABLE(id TEXT, name TEXT, email TEXT, avatar TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT u.id, u.name, u.email, u.avatar
  FROM aristo.mentor_students ms
  JOIN aristo.users u ON u.id = ms.student_id
  WHERE ms.mentor_id = p_mentor_id
    AND p_mentor_id = aristo.current_user_id()
  ORDER BY u.name
$$;
REVOKE EXECUTE ON FUNCTION aristo.get_mentor_roster(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.get_mentor_roster(text) TO aristo_app;

-- Replaces the single-row users lookup in src/server/mentor.ts's
-- dailySummary(). Re-checks the mentor_students link internally (the
-- caller already checked it too, one line above in dailySummary) so this
-- function is never safe to call with an unlinked pair even if some future
-- call site forgets that check.
CREATE OR REPLACE FUNCTION aristo.get_linked_student(p_mentor_id TEXT, p_student_id TEXT)
RETURNS TABLE(id TEXT, name TEXT, email TEXT, avatar TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT u.id, u.name, u.email, u.avatar
  FROM aristo.users u
  WHERE u.id = p_student_id
    AND p_mentor_id = aristo.current_user_id()
    AND EXISTS (
      SELECT 1 FROM aristo.mentor_students
      WHERE mentor_id = p_mentor_id AND student_id = p_student_id
    )
$$;
REVOKE EXECUTE ON FUNCTION aristo.get_linked_student(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.get_linked_student(text, text) TO aristo_app;

-- Replaces the ranking query in src/server/study.ts's state() (around
-- lines 78-82): a student's ranking among the other students who share at
-- least one mentor with them. Confirmed with the user as a real existing
-- feature (the "Ranking da mentoria" card in perfil/page.tsx), not an
-- inferred one — its origin was traced back to this exact query before any
-- policy work started. Returns only (id, name, xp), deliberately never the
-- full row: a broad users SELECT policy covering "any sibling under the
-- same mentor" would expose password to every student in that mentor's
-- roster, for a feature that only ever needs a name and a number.
CREATE OR REPLACE FUNCTION aristo.get_mentor_ranking(requesting_user_id TEXT)
RETURNS TABLE(id TEXT, name TEXT, xp BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT u.id, u.name,
    COALESCE((SELECT COUNT(*) * 20 FROM aristo.records r WHERE r.user_id = u.id AND r.done = 1), 0) AS xp
  FROM aristo.users u
  WHERE requesting_user_id = aristo.current_user_id()
    AND u.id IN (
      SELECT ms.student_id FROM aristo.mentor_students ms
      WHERE ms.mentor_id IN (
        SELECT mentor_id FROM aristo.mentor_students WHERE student_id = requesting_user_id
      )
    )
  ORDER BY xp DESC, u.name, u.id
$$;
REVOKE EXECUTE ON FUNCTION aristo.get_mentor_ranking(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.get_mentor_ranking(text) TO aristo_app;

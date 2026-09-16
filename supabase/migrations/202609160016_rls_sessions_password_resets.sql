-- Fase 3B part 5, batch 6: sessions and password_resets — the two
-- "token-possession" tables. Their real security model has never been
-- row-level identity: a session is legitimate because the caller presents
-- the exact hashed token, not because current_user_id() matches; a
-- password_resets row is the same, deliberately reachable by someone who
-- isn't authenticated as anyone yet (that's the entire point of password
-- recovery). RLS here mainly documents and enforces "only the app itself
-- (aristo_app) touches these tables at all" rather than adding per-row
-- identity checks that the app's own logic doesn't (and structurally
-- can't) make.
--
-- Confirmed by grepping every remaining reference to both tables in
-- src/server and src/app/api before writing this (batch 5 already routed
-- the one raw `sessions` SELECT through aristo.resolve_session_user(), so
-- sessions has no raw SELECT left in the app at all):
--   sessions:
--     INSERT — src/server/auth.ts's createSession(), always self
--       (setActor(userId) runs immediately before it).
--     DELETE — auth.ts's expired-session cleanup (no actor: sweeps
--       everyone's expired rows) and logout() (no actor: reads the raw
--       token straight off the cookie, never resolves an actor first);
--       src/app/api/auth/route.ts's change-password and
--       recovery/route.ts's reset-confirm both delete the caller's own
--       sessions, but by then an actor *is* set (recovery/route.ts's
--       reset-confirm only got one via batch 5's setActor(row.user_id)
--       fix) — USING(true) covers all four call sites uniformly, correctly,
--       since a self-scoped delete is trivially also true.
--   password_resets:
--     SELECT — recovery/route.ts's token verification, no actor (this is
--       the query that would *establish* an actor, if the row is found).
--     INSERT — recovery/route.ts's "request" branch, no actor at all: the
--       requester was never authenticated as the account being reset (an
--       email lookup, not a login) — there is no current_user_id() to
--       check the new row's user_id against. A self-only WITH CHECK here
--       would refuse the app's *only* real INSERT into this table.
--     DELETE — the same "request" branch's expired-row sweep and its
--       insert-then-rollback-on-email-failure path both run with no actor;
--       the "reset" branch's consume-the-token delete has an actor (same
--       batch 5 fix) but, same as sessions, USING(true) covers it too.
--
-- UPDATE has no confirmed path on either table — following the same
-- default used for tenant_members/organization_members/users wherever a
-- command has no real caller today: platform-admin only, not USING(true),
-- so a hypothetical future admin UPDATE feature doesn't inherit an
-- accidentally wide-open policy just because SELECT/DELETE needed one.

CREATE POLICY sessions_select ON aristo.sessions
  FOR SELECT TO aristo_app USING (true);
CREATE POLICY sessions_insert ON aristo.sessions
  FOR INSERT TO aristo_app WITH CHECK (user_id = aristo.current_user_id());
CREATE POLICY sessions_update ON aristo.sessions
  FOR UPDATE TO aristo_app
  USING (aristo.is_platform_admin())
  WITH CHECK (aristo.is_platform_admin());
CREATE POLICY sessions_delete ON aristo.sessions
  FOR DELETE TO aristo_app USING (true);

CREATE POLICY password_resets_select ON aristo.password_resets
  FOR SELECT TO aristo_app USING (true);
CREATE POLICY password_resets_insert ON aristo.password_resets
  FOR INSERT TO aristo_app WITH CHECK (true);
CREATE POLICY password_resets_update ON aristo.password_resets
  FOR UPDATE TO aristo_app
  USING (aristo.is_platform_admin())
  WITH CHECK (aristo.is_platform_admin());
CREATE POLICY password_resets_delete ON aristo.password_resets
  FOR DELETE TO aristo_app USING (true);

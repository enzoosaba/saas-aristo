-- Fase 3B part 5, batch 8 (unplanned — a real gap, not a new phase):
-- aristo.profiles. Migration 008 put FORCE ROW LEVEL SECURITY on this
-- table along with the other 18, but no batch (1 through 7) ever wrote a
-- policy for it — a plain miscount, caught only by re-deriving the exact
-- 19-table list from migration 008 itself rather than trusting an earlier
-- summary. Left unfixed, this table would have blocked every single
-- registration the moment part 7's cutover made aristo_app the connecting
-- role: identity.ts's createProfile() INSERTs into profiles inside the
-- same transaction as the account itself, so a zero-policy table there
-- would throw "new row violates row-level security policy" and roll back
-- account creation entirely — a correctness bug found before it shipped,
-- not after.
--
-- Confirmed by grep (src/server/identity.ts, the only file that touches
-- this table): INSERT (createProfile, called once from registration,
-- always self — setActor(id) runs before it) and two UPDATEs
-- (updateProfileName/updateProfileAvatar, always `WHERE user_id=?` with
-- the caller's own id). No raw SELECT exists anywhere — profiles is a
-- write-only shadow table today (users.role/users.name/users.avatar stay
-- authoritative; see identity.ts's own header comment). Same shape as
-- every self-scoped table in this phase — no new function needed.
CREATE POLICY profiles_select ON aristo.profiles
  FOR SELECT TO aristo_app
  USING (user_id = aristo.current_user_id() OR aristo.is_platform_admin());
CREATE POLICY profiles_insert ON aristo.profiles
  FOR INSERT TO aristo_app
  WITH CHECK (user_id = aristo.current_user_id() OR aristo.is_platform_admin());
CREATE POLICY profiles_update ON aristo.profiles
  FOR UPDATE TO aristo_app
  USING (user_id = aristo.current_user_id() OR aristo.is_platform_admin())
  WITH CHECK (user_id = aristo.current_user_id() OR aristo.is_platform_admin());
-- No confirmed DELETE path (rows are only ever removed via ON DELETE
-- CASCADE from aristo.users, run as the owning role) — admin-only default,
-- same convention as every other unconfirmed command since batch 4.
CREATE POLICY profiles_delete ON aristo.profiles
  FOR DELETE TO aristo_app
  USING (aristo.is_platform_admin());

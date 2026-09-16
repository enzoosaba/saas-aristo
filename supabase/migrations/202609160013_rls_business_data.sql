-- Fase 3B part 5, batch 3: items, records, plans, questions,
-- study_sessions. Same shape across all 5 (user_id + tenant_id +
-- organization_id, Fase 2A), so the policies are generated mechanically
-- in one loop rather than copy-pasted 5 times — but each table's
-- isolation test still runs separately (see tests/postgres.test.mjs),
-- precisely so a quirk unique to one of the 5 can't hide behind the
-- other 4 passing.
--
-- SELECT reuses can_access_business_row() from migration 009 exactly as
-- designed for this: self, platform admin, this tenant's admin, or an
-- organization mentor with an existing mentor_students link to the row's
-- owner.
--
-- INSERT/UPDATE/DELETE are deliberately narrower than SELECT: confirmed
-- directly against the current codebase (src/server/study.ts, the only
-- place that writes any of these 5 tables) that every write always uses
-- the authenticated caller's own id — there is no mentor- or
-- tenant-admin-on-behalf-of-a-student write path anywhere in the app
-- today. Granting one here "for later" would be exactly the kind of
-- unrequested capability this project avoids creating ahead of a real
-- need. Only the row's own owner, or a platform admin, can write.
DO $$
DECLARE
  t TEXT;
  write_condition TEXT := 'user_id = aristo.current_user_id() OR aristo.is_platform_admin()';
BEGIN
  FOREACH t IN ARRAY ARRAY['items', 'records', 'plans', 'questions', 'study_sessions']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I_select ON aristo.%I FOR SELECT TO aristo_app USING (aristo.can_access_business_row(user_id, tenant_id, organization_id))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY %I_insert ON aristo.%I FOR INSERT TO aristo_app WITH CHECK (%s)',
      t, t, write_condition
    );
    EXECUTE format(
      'CREATE POLICY %I_update ON aristo.%I FOR UPDATE TO aristo_app USING (%s) WITH CHECK (%s)',
      t, t, write_condition, write_condition
    );
    EXECUTE format(
      'CREATE POLICY %I_delete ON aristo.%I FOR DELETE TO aristo_app USING (%s)',
      t, t, write_condition
    );
  END LOOP;
END $$;

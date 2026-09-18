-- Fase 4A: minimal admin panel ("Torre de Controle") for platform_admin to
-- promote/demote an existing account's role, without running
-- scripts/set-mentor.mjs by hand or depending on the self-registration +
-- addStudent chicken-and-egg flow.
--
-- Creating a brand-new member account does NOT need a new function here:
-- verified directly against the live database (information_schema.column_
-- privileges) that batch 5's REVOKE/GRANT UPDATE (name, avatar, password)
-- only restricted UPDATE — INSERT on aristo.users still carries the
-- table-wide column grant from migration 008, and users_insert's policy
-- already reads `id = current_user_id() OR is_platform_admin()`. An admin
-- actor can therefore INSERT a new users row with any role directly, and
-- every other table involved (profiles, tenant_members,
-- organization_members) already has `is_platform_admin()` as one of its
-- own WITH CHECK clauses. The existing app-layer functions
-- (createProfile/syncTenantMembership/ensureOrganizationMembership) are
-- reused as-is for this, under withActor(adminId, ...) — no SQL change
-- needed for that half.
--
-- Promoting/demoting an *existing* row is different: users.role has no
-- UPDATE column privilege for aristo_app at all (batch 5, deliberately,
-- including for platform_admin — "any future admin role-promotion feature
-- must run through the postgres connection, not aristo_app" was the
-- explicit note left for this exact moment). This function is that
-- promised exception: SECURITY DEFINER, so it runs as the owning role
-- internally and can write role directly, but only after checking
-- is_platform_admin() itself — the privilege boundary moves from "no
-- column grant at all" to "this one narrow, gated path", never a general
-- aristo_app UPDATE capability.
CREATE OR REPLACE FUNCTION aristo.set_member_role(p_target_user_id TEXT, p_new_role TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = aristo, pg_catalog AS $$
BEGIN
  IF NOT aristo.is_platform_admin() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_new_role NOT IN ('student', 'mentor') THEN
    RAISE EXCEPTION 'invalid role: %', p_new_role USING ERRCODE = '22023';
  END IF;

  UPDATE aristo.users SET role = p_new_role WHERE id = p_target_user_id;

  -- Keeps organization_members.member_role in sync with users.role, the
  -- same invariant addStudent's self-promotion clause already relies on
  -- elsewhere (has_mentor_role() reads users.role as the source of truth).
  UPDATE aristo.organization_members
    SET member_role = CASE WHEN p_new_role = 'mentor' THEN 'MENTOR' ELSE 'STUDENT' END,
        updated_at = now()
    WHERE user_id = p_target_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION aristo.set_member_role(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.set_member_role(text, text) TO aristo_app;

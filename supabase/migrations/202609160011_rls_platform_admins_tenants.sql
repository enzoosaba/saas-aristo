-- Fase 3B part 5, batch 1 of N: first real RLS policies. Scope
-- deliberately narrow — platform_admins and tenants only, the two
-- simplest tables — to prove the full pattern (policy + empirical
-- isolation test under aristo_app) before expanding to the remaining 17.
--
-- Still safe to apply: the running app connects as the owning role
-- (postgres), which bypasses RLS regardless of any policy here. Nothing
-- observable changes until the Fase 3B cutover (part 7).

-- Revision of a migration 009 decision: is_platform_admin() was
-- deliberately SECURITY INVOKER there, reasoning that platform_admins'
-- own future policy would only ever be "your own row" (no recursion to
-- avoid). That reasoning no longer holds — the actual requirement is
-- "any platform admin sees every row", which means is_platform_admin()'s
-- internal SELECT on platform_admins would otherwise be filtered by that
-- same policy, which itself calls is_platform_admin() — infinite
-- recursion, same failure mode already solved for tenant_members/
-- organization_members. Switched to SECURITY DEFINER for the same reason.
CREATE OR REPLACE FUNCTION aristo.is_platform_admin() RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM aristo.platform_admins
    WHERE user_id = aristo.current_user_id() AND status = 'active'
  )
$$;
-- CREATE OR REPLACE preserves the EXECUTE grant from migration 010
-- (REVOKE FROM PUBLIC / GRANT TO aristo_app) — it only changes the
-- function body/security properties, not its ACL or ownership.

-- platform_admins: visible and writable only by platform admins. No
-- self-service bootstrap policy for the very first admin on purpose — the
-- table is empty in production today, and the only way to seat someone
-- there is a trusted operator connecting as the owning role (which always
-- bypasses RLS), the same way it already works before this migration.
CREATE POLICY platform_admins_select ON aristo.platform_admins
  FOR SELECT TO aristo_app
  USING (aristo.is_platform_admin());
CREATE POLICY platform_admins_insert ON aristo.platform_admins
  FOR INSERT TO aristo_app
  WITH CHECK (aristo.is_platform_admin());
CREATE POLICY platform_admins_update ON aristo.platform_admins
  FOR UPDATE TO aristo_app
  USING (aristo.is_platform_admin())
  WITH CHECK (aristo.is_platform_admin());
CREATE POLICY platform_admins_delete ON aristo.platform_admins
  FOR DELETE TO aristo_app
  USING (aristo.is_platform_admin());

-- tenants: platform admin sees/writes everything; any active member of a
-- tenant (student, mentor or admin) can see that one tenant's row;
-- creating/deleting tenants is platform-only; updating a tenant's own
-- row (name/slug/status) is allowed for that tenant's own TENANT_ADMIN
-- too. Reuses is_tenant_member()/can_manage_tenant() from migration 009
-- rather than inlining new conditions.
CREATE POLICY tenants_select ON aristo.tenants
  FOR SELECT TO aristo_app
  USING (aristo.is_platform_admin() OR aristo.is_tenant_member(id));
CREATE POLICY tenants_insert ON aristo.tenants
  FOR INSERT TO aristo_app
  WITH CHECK (aristo.is_platform_admin());
CREATE POLICY tenants_update ON aristo.tenants
  FOR UPDATE TO aristo_app
  USING (aristo.can_manage_tenant(id))
  WITH CHECK (aristo.can_manage_tenant(id));
CREATE POLICY tenants_delete ON aristo.tenants
  FOR DELETE TO aristo_app
  USING (aristo.is_platform_admin());

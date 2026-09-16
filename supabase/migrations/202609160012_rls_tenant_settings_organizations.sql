-- Fase 3B part 5, batch 2: tenant_settings and organizations. Same shape
-- as batch 1 (platform_admins/tenants) — no new design decision, no new
-- function. Every condition below reuses a migration-009 SECURITY DEFINER
-- function (is_tenant_member, is_organization_member, can_manage_tenant,
-- can_manage_organization, is_platform_admin) rather than inlining a new
-- one. Still zero observable impact — the running app connects as the
-- owning role (postgres), which bypasses RLS; the cutover to aristo_app is
-- still part 7.

-- tenant_settings: readable by anyone belonging to the tenant (branding/
-- feature flags need to render for students and mentors too, not just
-- admins); writable (insert/update) by that tenant's own admin or a
-- platform admin; deletable by platform admin only.
CREATE POLICY tenant_settings_select ON aristo.tenant_settings
  FOR SELECT TO aristo_app
  USING (aristo.is_platform_admin() OR aristo.is_tenant_member(tenant_id));
CREATE POLICY tenant_settings_insert ON aristo.tenant_settings
  FOR INSERT TO aristo_app
  WITH CHECK (aristo.can_manage_tenant(tenant_id));
CREATE POLICY tenant_settings_update ON aristo.tenant_settings
  FOR UPDATE TO aristo_app
  USING (aristo.can_manage_tenant(tenant_id))
  WITH CHECK (aristo.can_manage_tenant(tenant_id));
CREATE POLICY tenant_settings_delete ON aristo.tenant_settings
  FOR DELETE TO aristo_app
  USING (aristo.is_platform_admin());

-- organizations: readable by platform admin, that tenant's admin, or any
-- active member (mentor or student) of the organization itself; creating
-- an organization is tenant-level (platform admin or that tenant's admin
-- only — not a mentor, since a mentor can't yet be a member of an
-- organization that doesn't exist); updating (e.g. renaming, changing
-- status) also allowed for the organization's own mentor via
-- can_manage_organization(); deleting stays tenant-level, deliberately
-- narrower than update — a mentor should not be able to delete the
-- organization they merely mentor in.
CREATE POLICY organizations_select ON aristo.organizations
  FOR SELECT TO aristo_app
  USING (
    aristo.is_platform_admin()
    OR aristo.can_manage_tenant(tenant_id)
    OR aristo.is_organization_member(id)
  );
CREATE POLICY organizations_insert ON aristo.organizations
  FOR INSERT TO aristo_app
  WITH CHECK (aristo.can_manage_tenant(tenant_id));
CREATE POLICY organizations_update ON aristo.organizations
  FOR UPDATE TO aristo_app
  USING (aristo.can_manage_organization(id))
  WITH CHECK (aristo.can_manage_organization(id));
CREATE POLICY organizations_delete ON aristo.organizations
  FOR DELETE TO aristo_app
  USING (aristo.can_manage_tenant(tenant_id));

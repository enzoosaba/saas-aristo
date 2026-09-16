-- Fase 3B part 7 — critical bug found and fixed before the cutover, not
-- during a design review like every other batch this phase: a real smoke
-- test against the live Supabase database (registering one account
-- through the real HTTP API with aristo_app actually enforcing RLS) failed
-- with "Configuração da plataforma incompleta: tenant padrão ausente."
-- Root cause verified with a direct query, not assumed: identity.ts's
-- syncTenantMembership() does `SELECT id FROM tenants WHERE slug=?` to
-- discover Tenant 01's id during registration — but at that exact moment
-- the actor is a genuinely brand-new user with zero tenant_members rows
-- and isn't a platform admin either, so batch 1's `tenants_select` policy
-- (`is_platform_admin() OR is_tenant_member(id)`) correctly, structurally,
-- always excludes this row for them. Every registration would have hit
-- this. defaultOrganization() (used by ensureOrganizationMembership and
-- releaseOrganizationMembershipIfOrphaned) has the identical problem one
-- level deeper: its join of organizations to tenants also needs the
-- tenants row visible to the same not-yet-a-member actor.
--
-- This is the exact same class of chicken-and-egg problem already solved
-- twice this phase (batch 4's has_mentor_role, batch 7's
-- student_has_any_mentor_link) — a SECURITY DEFINER function, not a
-- broader SELECT policy. Broadening tenants_select instead (e.g. "any
-- active tenant is visible to anyone") would leak the existence of every
-- other tenant to every user, defeating the isolation this whole phase
-- exists to build. Hardcoded to Tenant 01/Turma Inicial specifically
-- (not parameterized by an arbitrary slug) because that's the only
-- lookup the app actually performs today — a general "find any tenant by
-- any slug" function would let any authenticated actor enumerate tenant
-- slugs that don't concern them, a capability nothing in the app needs.
CREATE OR REPLACE FUNCTION aristo.default_organization()
RETURNS TABLE(tenant_id UUID, organization_id UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = aristo, pg_catalog STABLE AS $$
  SELECT t.id AS tenant_id, o.id AS organization_id
  FROM aristo.tenants t
  JOIN aristo.organizations o ON o.tenant_id = t.id
  WHERE t.slug = 'mentoria-coelho' AND o.name = 'Turma Inicial'
$$;
REVOKE EXECUTE ON FUNCTION aristo.default_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aristo.default_organization() TO aristo_app;

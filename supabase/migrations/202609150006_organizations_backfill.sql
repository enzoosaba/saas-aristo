-- Fase 1 (part 2): every current Tenant 01 member (mentor or student) is
-- enrolled into a single default organization, "Turma Inicial" — matching
-- today's reality (one classroom) without pretending mentor_students maps
-- to anything more granular yet. Idempotent via the UNIQUE constraints
-- from migration 005.

INSERT INTO aristo.organizations (tenant_id, name, status)
SELECT id, 'Turma Inicial', 'active'
FROM aristo.tenants WHERE slug = 'mentoria-coelho'
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO aristo.organization_members (tenant_id, organization_id, user_id, member_role, joined_at)
SELECT tm.tenant_id, o.id, tm.user_id, tm.role, tm.joined_at
FROM aristo.tenant_members tm
JOIN aristo.organizations o
  ON o.tenant_id = tm.tenant_id AND o.name = 'Turma Inicial'
WHERE tm.role IN ('MENTOR', 'STUDENT')
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Fase 1: organizations sit below tenants — a tenant can have many
-- (turmas, cohorts). mentor_students remains the live source of truth for
-- mentor.ts's authorization; these tables are additive and unread by any
-- application code yet. Postgres-only, same as every table from Fase 0B on.

CREATE TABLE aristo.organizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES aristo.tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  logo_url     TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  start_date   DATE,
  end_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX organizations_tenant ON aristo.organizations(tenant_id);

-- tenant_id is denormalized here (also reachable via organization_id ->
-- organizations.tenant_id) so a future RLS policy can scope on it directly
-- without a join. member_role mirrors tenant_members.role for the two roles
-- an organization can actually contain today; TENANT_ADMIN operates above
-- organizations, not inside one, so it is deliberately not a valid value.
CREATE TABLE aristo.organization_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES aristo.tenants(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES aristo.organizations(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  member_role      TEXT NOT NULL CHECK (member_role IN ('MENTOR','STUDENT')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX organization_members_user ON aristo.organization_members(user_id);
CREATE INDEX organization_members_org_role ON aristo.organization_members(organization_id, member_role);

ALTER TABLE aristo.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.organization_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON aristo.organizations        FROM PUBLIC;
REVOKE ALL ON aristo.organization_members FROM PUBLIC;

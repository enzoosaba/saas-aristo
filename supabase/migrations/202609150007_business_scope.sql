-- Fase 2A: propagate tenant/organization scope onto the tables that hold
-- actual study data. Every row that exists today belongs entirely to
-- Tenant 01 / Turma Inicial — no join-based inference (records depends on
-- items and user_id, but is backfilled flatly like everything else, per
-- the explicit call for this phase: the data doesn't need it and it isn't
-- worth the complexity). user_id and mentor_students are untouched; these
-- columns are Postgres-only, same as the rest of the SaaS foundation (see
-- src/server/sqlite.ts, unchanged).

ALTER TABLE aristo.items
  ADD COLUMN tenant_id       UUID REFERENCES aristo.tenants(id),
  ADD COLUMN organization_id UUID REFERENCES aristo.organizations(id);
ALTER TABLE aristo.records
  ADD COLUMN tenant_id       UUID REFERENCES aristo.tenants(id),
  ADD COLUMN organization_id UUID REFERENCES aristo.organizations(id);
ALTER TABLE aristo.plans
  ADD COLUMN tenant_id       UUID REFERENCES aristo.tenants(id),
  ADD COLUMN organization_id UUID REFERENCES aristo.organizations(id);
ALTER TABLE aristo.questions
  ADD COLUMN tenant_id       UUID REFERENCES aristo.tenants(id),
  ADD COLUMN organization_id UUID REFERENCES aristo.organizations(id);
ALTER TABLE aristo.study_sessions
  ADD COLUMN tenant_id       UUID REFERENCES aristo.tenants(id),
  ADD COLUMN organization_id UUID REFERENCES aristo.organizations(id);

-- Backfill, then validate 100% coverage before locking the columns down.
-- Aborts loudly (rolling back this whole migration file, since
-- migrate-postgres.mjs runs every file inside one transaction) if Tenant 01
-- or its default organization are ever missing, instead of silently
-- producing NOT NULL columns full of nulls.
DO $$
DECLARE
  v_tenant_id UUID;
  v_org_id UUID;
BEGIN
  SELECT id INTO v_tenant_id FROM aristo.tenants WHERE slug = 'mentoria-coelho';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant 01 (mentoria-coelho) ausente — backfill abortado.';
  END IF;

  SELECT id INTO v_org_id FROM aristo.organizations
    WHERE tenant_id = v_tenant_id AND name = 'Turma Inicial';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organização padrão (Turma Inicial) ausente — backfill abortado.';
  END IF;

  UPDATE aristo.items          SET tenant_id = v_tenant_id, organization_id = v_org_id WHERE tenant_id IS NULL;
  UPDATE aristo.records        SET tenant_id = v_tenant_id, organization_id = v_org_id WHERE tenant_id IS NULL;
  UPDATE aristo.plans          SET tenant_id = v_tenant_id, organization_id = v_org_id WHERE tenant_id IS NULL;
  UPDATE aristo.questions      SET tenant_id = v_tenant_id, organization_id = v_org_id WHERE tenant_id IS NULL;
  UPDATE aristo.study_sessions SET tenant_id = v_tenant_id, organization_id = v_org_id WHERE tenant_id IS NULL;

  IF EXISTS (SELECT 1 FROM aristo.items WHERE tenant_id IS NULL OR organization_id IS NULL) THEN
    RAISE EXCEPTION 'Backfill de items incompleto.';
  END IF;
  IF EXISTS (SELECT 1 FROM aristo.records WHERE tenant_id IS NULL OR organization_id IS NULL) THEN
    RAISE EXCEPTION 'Backfill de records incompleto.';
  END IF;
  IF EXISTS (SELECT 1 FROM aristo.plans WHERE tenant_id IS NULL OR organization_id IS NULL) THEN
    RAISE EXCEPTION 'Backfill de plans incompleto.';
  END IF;
  IF EXISTS (SELECT 1 FROM aristo.questions WHERE tenant_id IS NULL OR organization_id IS NULL) THEN
    RAISE EXCEPTION 'Backfill de questions incompleto.';
  END IF;
  IF EXISTS (SELECT 1 FROM aristo.study_sessions WHERE tenant_id IS NULL OR organization_id IS NULL) THEN
    RAISE EXCEPTION 'Backfill de study_sessions incompleto.';
  END IF;
END $$;

ALTER TABLE aristo.items
  ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE aristo.records
  ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE aristo.plans
  ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE aristo.questions
  ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE aristo.study_sessions
  ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN organization_id SET NOT NULL;

-- Plain tenant_id indices for every table, plus one (organization_id, ...)
-- combination each that mirrors this table's existing per-user index shape
-- — useful once a mentor/turma dashboard reads across students (Fase 4+).
-- Nothing queries these columns yet; sized for the query shapes that
-- already exist elsewhere in this schema, not speculative ones.
CREATE INDEX items_tenant                      ON aristo.items(tenant_id);
CREATE INDEX items_organization_user           ON aristo.items(organization_id, user_id);
CREATE INDEX records_tenant                    ON aristo.records(tenant_id);
CREATE INDEX records_organization_date         ON aristo.records(organization_id, date);
CREATE INDEX plans_tenant                      ON aristo.plans(tenant_id);
CREATE INDEX plans_organization_date           ON aristo.plans(organization_id, date);
CREATE INDEX questions_tenant                  ON aristo.questions(tenant_id);
CREATE INDEX questions_organization_user       ON aristo.questions(organization_id, user_id);
CREATE INDEX study_sessions_tenant             ON aristo.study_sessions(tenant_id);
CREATE INDEX study_sessions_organization_user  ON aristo.study_sessions(organization_id, user_id);

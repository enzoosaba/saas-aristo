-- Fase 0B (part 2): append-only audit log, plus backfill of Tenant 01
-- (Mentoria Coelho) from the data that already exists in aristo.users.
-- Every insert below is idempotent via ON CONFLICT DO NOTHING, matching
-- this project's checksum-guarded migration runner.

CREATE TABLE aristo.audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID REFERENCES aristo.tenants(id) ON DELETE SET NULL,
  user_id      TEXT REFERENCES aristo.users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  old_value    JSONB,
  new_value    JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant ON aristo.audit_logs(tenant_id, created_at);
CREATE INDEX audit_logs_entity ON aristo.audit_logs(entity_type, entity_id);
ALTER TABLE aristo.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON aristo.audit_logs FROM PUBLIC;

-- Tenant 01.
INSERT INTO aristo.tenants (name, slug, status)
VALUES ('Mentoria Coelho', 'mentoria-coelho', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO aristo.tenant_settings (
  tenant_id, platform_name, logo_url,
  ranking_enabled, gamification_enabled, financial_enabled, push_enabled
)
SELECT id, 'Mentoria Coelho', '/brand/coelho.png', true, true, false, false
FROM aristo.tenants WHERE slug = 'mentoria-coelho'
ON CONFLICT (tenant_id) DO NOTHING;

-- profiles: presentation data backfilled from aristo.users. created_at
-- there is a BIGINT epoch-milliseconds column (see src/server/auth.ts,
-- Date.now()), hence the conversion.
INSERT INTO aristo.profiles (user_id, full_name, avatar_url, created_at)
SELECT id, name, avatar, to_timestamp(created_at / 1000.0)
FROM aristo.users
ON CONFLICT (user_id) DO NOTHING;

-- tenant_members: map the current users.role onto the tenant-scoped role.
-- TENANT_ADMIN is never assigned automatically here — nobody holds that
-- role until a human explicitly grants it.
INSERT INTO aristo.tenant_members (tenant_id, user_id, role, joined_at)
SELECT t.id, u.id,
       CASE WHEN u.role = 'mentor' THEN 'MENTOR' ELSE 'STUDENT' END,
       to_timestamp(u.created_at / 1000.0)
FROM aristo.users u
CROSS JOIN (SELECT id FROM aristo.tenants WHERE slug = 'mentoria-coelho') t
ON CONFLICT (tenant_id, user_id) DO NOTHING;

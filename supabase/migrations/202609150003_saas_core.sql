-- Fase 0B (part 1): SaaS foundation tables. Aristo is the platform; every
-- tenant (starting with Mentoria Coelho, backfilled in the next migration)
-- is a row in aristo.tenants, not a fork of this schema.
-- Postgres-only: these tables have no SQLite fallback (see src/server/sqlite.ts).

CREATE TABLE aristo.tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','trial','suspended','cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1:1 with aristo.users. user_id matches users.id's exact type (TEXT).
-- email/password stay in aristo.users on purpose — this table is
-- presentation data only, not a second identity table.
CREATE TABLE aristo.profiles (
  user_id     TEXT PRIMARY KEY REFERENCES aristo.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  avatar_url  TEXT,
  phone       TEXT,
  birth_date  DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant-scoped role only. SUPER_ADMIN is deliberately not a valid value
-- here: it is platform-wide, not tied to any single tenant — see
-- aristo.platform_admins below.
CREATE TABLE aristo.tenant_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES aristo.tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES aristo.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('TENANT_ADMIN','MENTOR','STUDENT')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_members_user ON aristo.tenant_members(user_id);
CREATE INDEX tenant_members_role ON aristo.tenant_members(tenant_id, role);

-- Platform-wide administrators, outside the tenant hierarchy entirely.
CREATE TABLE aristo.platform_admins (
  user_id     TEXT PRIMARY KEY REFERENCES aristo.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- White-label identity and feature flags, one row per tenant.
CREATE TABLE aristo.tenant_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL UNIQUE REFERENCES aristo.tenants(id) ON DELETE CASCADE,
  platform_name         TEXT NOT NULL,
  logo_url              TEXT,
  favicon_url           TEXT,
  primary_color         TEXT,
  secondary_color       TEXT,
  accent_color          TEXT,
  support_email         TEXT,
  support_phone         TEXT,
  custom_domain         TEXT UNIQUE,
  ranking_enabled       BOOLEAN NOT NULL DEFAULT true,
  gamification_enabled  BOOLEAN NOT NULL DEFAULT true,
  financial_enabled     BOOLEAN NOT NULL DEFAULT false,
  push_enabled          BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deny all direct client access, matching every other table in this schema.
-- Authorization is enforced by authenticated Next.js APIs; RLS policies
-- land in a later phase once tenant_id is populated on every domain table.
ALTER TABLE aristo.tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.tenant_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE aristo.tenant_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON aristo.tenants         FROM PUBLIC;
REVOKE ALL ON aristo.profiles        FROM PUBLIC;
REVOKE ALL ON aristo.tenant_members  FROM PUBLIC;
REVOKE ALL ON aristo.platform_admins FROM PUBLIC;
REVOKE ALL ON aristo.tenant_settings FROM PUBLIC;

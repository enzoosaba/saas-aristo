// Fase 0C: keeps the SaaS foundation (aristo.profiles / aristo.tenant_members)
// in sync with the current, still-authoritative users table. Postgres-only —
// these tables have no SQLite fallback (see src/server/sqlite.ts) — so every
// function here is a no-op when running against the local SQLite dev driver.
// users.role remains the real source of authorization; nothing here is read
// by requireUser()/requireMentor() yet.
import { db, isPostgres } from "./db";
import { HttpError } from "./http";
import type { User } from "@/lib/domain";

const TENANT_01_SLUG = "mentoria-coelho";

function tenantRole(role: User["role"]) {
  return role === "mentor" ? "MENTOR" : "STUDENT";
}

// Called once, at registration: the profile row does not exist yet.
export async function createProfile(
  userId: string,
  fullName: string,
  avatarUrl: string | null,
) {
  if (!isPostgres()) return;
  await db()
    .prepare(
      "INSERT INTO profiles(user_id,full_name,avatar_url) VALUES(?,?,?)",
    )
    .run(userId, fullName, avatarUrl);
}

// Called on later edits: the profile row is guaranteed to already exist,
// either from createProfile() above or from the Fase 0B backfill migration.
export async function updateProfileName(userId: string, fullName: string) {
  if (!isPostgres()) return;
  await db()
    .prepare(
      "UPDATE profiles SET full_name=?, updated_at=now() WHERE user_id=?",
    )
    .run(fullName, userId);
}

export async function updateProfileAvatar(
  userId: string,
  avatarUrl: string | null,
) {
  if (!isPostgres()) return;
  await db()
    .prepare(
      "UPDATE profiles SET avatar_url=?, updated_at=now() WHERE user_id=?",
    )
    .run(avatarUrl, userId);
}

// Enrolls (or updates the role of) a user in Tenant 01. Never assigns
// TENANT_ADMIN — only the two roles a registration can actually produce
// today — and never touches platform_admins.
export async function syncTenantMembership(
  userId: string,
  role: User["role"],
) {
  if (!isPostgres()) return;
  const tenant = (await db()
    .prepare("SELECT id FROM tenants WHERE slug=?")
    .get(TENANT_01_SLUG)) as { id: string } | undefined;
  // Tenant 01 is seeded by migration 202609150004 and must exist; treat its
  // absence as a hard failure so registration rolls back loudly instead of
  // silently producing a user with no tenant membership.
  if (!tenant)
    throw new HttpError(
      500,
      "Configuração da plataforma incompleta: tenant padrão ausente.",
    );
  await db()
    .prepare(
      `INSERT INTO tenant_members(tenant_id,user_id,role) VALUES(?,?,?)
       ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role, updated_at=now()`,
    )
    .run(tenant.id, userId, tenantRole(role));
}

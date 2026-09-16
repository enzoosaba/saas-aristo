// Fase 0C/1C: keeps the SaaS foundation (aristo.profiles, aristo.tenant_members,
// aristo.organization_members) in sync with the current, still-authoritative
// users/mentor_students tables. Postgres-only — none of these tables have a
// SQLite fallback (see src/server/sqlite.ts) — so every function here is a
// no-op when running against the local SQLite dev driver. users.role and
// mentor_students remain the real sources of truth; nothing here is read by
// requireUser()/requireMentor() yet.
import { db, isPostgres } from "./db";
import { HttpError } from "./http";
import type { User } from "@/lib/domain";

const TENANT_01_SLUG = "mentoria-coelho";
const DEFAULT_ORGANIZATION_NAME = "Turma Inicial";

function tenantRole(role: User["role"]) {
  return role === "mentor" ? "MENTOR" : "STUDENT";
}

type OrganizationRole = "MENTOR" | "STUDENT";

// Tenant 01's single default organization, seeded by migration
// 202609150006. Resolved by name every call rather than cached: cheap,
// and correct even if that migration is ever re-run in a fresh environment.
async function defaultOrganization() {
  const org = (await db()
    .prepare(
      `SELECT o.id AS organization_id, o.tenant_id AS tenant_id
       FROM organizations o JOIN tenants t ON t.id = o.tenant_id
       WHERE t.slug=? AND o.name=?`,
    )
    .get(TENANT_01_SLUG, DEFAULT_ORGANIZATION_NAME)) as
    | { organization_id: string; tenant_id: string }
    | undefined;
  if (!org)
    throw new HttpError(
      500,
      "Configuração da plataforma incompleta: organização padrão ausente.",
    );
  return org;
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

// Fase 1C: called from src/server/mentor.ts (addStudent) whenever a
// mentor_students link is created — for both the mentor and the student
// side, since either one might not have touched the organization before.
// Reactivates a previously suspended membership (see
// releaseOrganizationMembershipIfOrphaned) rather than leaving it stale.
export async function ensureOrganizationMembership(
  userId: string,
  role: OrganizationRole,
) {
  if (!isPostgres()) return;
  const { organization_id, tenant_id } = await defaultOrganization();
  await db()
    .prepare(
      `INSERT INTO organization_members(tenant_id,organization_id,user_id,member_role,status)
       VALUES(?,?,?,?,'active')
       ON CONFLICT(organization_id,user_id) DO UPDATE
         SET member_role=excluded.member_role, status='active', updated_at=now()`,
    )
    .run(tenant_id, organization_id, userId, role);
}

// Fase 1C: called from mentor.ts (removeStudent) after a mentor_students
// link is deleted. A student can have more than one mentor, so losing one
// link does not necessarily mean they left the organization — only suspend
// the membership when no mentor_students row references them at all.
// Mentors are never released here; they are only ever added by
// ensureOrganizationMembership, never removed by this function.
export async function releaseOrganizationMembershipIfOrphaned(
  studentId: string,
) {
  if (!isPostgres()) return;
  const stillLinked = await db()
    .prepare("SELECT 1 FROM mentor_students WHERE student_id=? LIMIT 1")
    .get(studentId);
  if (stillLinked) return;
  const { organization_id } = await defaultOrganization();
  await db()
    .prepare(
      "UPDATE organization_members SET status='suspended', updated_at=now() WHERE organization_id=? AND user_id=?",
    )
    .run(organization_id, studentId);
}

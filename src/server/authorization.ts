// Fase 3A: authorization decisions layered on top of the SaaS foundation
// (platform_admins, tenant_members, organization_members). Postgres-only —
// same reason as identity.ts (see its header). users.role and
// mentor_students remain untouched and still work as a fallback — nothing
// here has been made the *only* way to get access yet; see requireMentor()
// in src/app/api/mentor/route.ts for how the fallback is wired in.
import { db, isPostgres } from "./db";

export type TenantRole = "TENANT_ADMIN" | "MENTOR" | "STUDENT";
export type OrganizationRole = "MENTOR" | "STUDENT";

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  if (!isPostgres()) return false;
  const row = await db()
    .prepare(
      "SELECT 1 FROM platform_admins WHERE user_id=? AND status='active'",
    )
    .get(userId);
  return !!row;
}

export async function getActiveTenantMembership(
  userId: string,
  tenantId: string,
): Promise<{ role: TenantRole } | null> {
  if (!isPostgres()) return null;
  const row = (await db()
    .prepare(
      "SELECT role FROM tenant_members WHERE user_id=? AND tenant_id=? AND status='active'",
    )
    .get(userId, tenantId)) as { role: TenantRole } | undefined;
  return row ?? null;
}

export async function getActiveOrganizationMembership(
  userId: string,
  organizationId: string,
): Promise<{ role: OrganizationRole } | null> {
  if (!isPostgres()) return null;
  const row = (await db()
    .prepare(
      "SELECT member_role AS role FROM organization_members WHERE user_id=? AND organization_id=? AND status='active'",
    )
    .get(userId, organizationId)) as { role: OrganizationRole } | undefined;
  return row ?? null;
}

// SUPER_ADMIN (platform_admins) or this tenant's own TENANT_ADMIN.
export async function canManageTenant(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  if (await isPlatformAdmin(userId)) return true;
  const membership = await getActiveTenantMembership(userId, tenantId);
  return membership?.role === "TENANT_ADMIN";
}

// Anyone who can manage the organization's tenant, or an active MENTOR of
// this specific organization.
export async function canManageOrganization(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  if (!isPostgres()) return false;
  const organization = (await db()
    .prepare("SELECT tenant_id FROM organizations WHERE id=?")
    .get(organizationId)) as { tenant_id: string } | undefined;
  if (!organization) return false;
  if (await canManageTenant(userId, organization.tenant_id)) return true;
  const membership = await getActiveOrganizationMembership(
    userId,
    organizationId,
  );
  return membership?.role === "MENTOR";
}

// A user always sees their own data. Otherwise: platform admin, this
// tenant's admin, or an active mentor_students link — mirroring the exact
// rule src/server/mentor.ts's dailySummary already enforces today — AND the
// student must actually belong to the named organization (defense in
// depth for when more than one organization exists). mentor_students
// itself carries no organization dimension yet, so that link alone isn't
// sufficient once there's more than one organization to distinguish.
export async function canAccessStudent(
  userId: string,
  studentId: string,
  organizationId: string,
): Promise<boolean> {
  if (userId === studentId) return true;
  if (!isPostgres()) return false;
  if (await isPlatformAdmin(userId)) return true;
  const organization = (await db()
    .prepare("SELECT tenant_id FROM organizations WHERE id=?")
    .get(organizationId)) as { tenant_id: string } | undefined;
  if (!organization) return false;
  if (await canManageTenant(userId, organization.tenant_id)) return true;
  const linked = await db()
    .prepare(
      "SELECT 1 FROM mentor_students WHERE mentor_id=? AND student_id=?",
    )
    .get(userId, studentId);
  if (!linked) return false;
  const studentMembership = await getActiveOrganizationMembership(
    studentId,
    organizationId,
  );
  return !!studentMembership;
}

// Blanket gate for routes that don't yet know which organization is
// relevant (e.g. /api/mentor before any student is named): "is this user
// an active MENTOR of at least one organization?" See requireMentor() for
// how this combines with the users.role fallback.
export async function isMentorOfAnyOrganization(
  userId: string,
): Promise<boolean> {
  if (!isPostgres()) return false;
  const row = await db()
    .prepare(
      "SELECT 1 FROM organization_members WHERE user_id=? AND member_role='MENTOR' AND status='active'",
    )
    .get(userId);
  return !!row;
}

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
//
// Fase 3B part 7: caught by a real smoke test against Supabase with RLS
// actually enforced, not by reasoning about it — a plain join of
// organizations to tenants requires the caller to already pass
// tenants_select's policy (is_platform_admin() OR is_tenant_member(id)),
// which a genuinely brand-new registrant never does yet (that's what this
// call is helping to establish). Routed through
// aristo.default_organization() under Postgres, a SECURITY DEFINER
// function for exactly this chicken-and-egg reason (same shape as
// has_mentor_role/student_has_any_mentor_link). SQLite has no RLS to
// route around, so it keeps the original join.
async function defaultOrganization() {
  const org = (
    isPostgres()
      ? await db()
          .prepare("SELECT * FROM aristo.default_organization()")
          .get()
      : await db()
          .prepare(
            `SELECT o.id AS organization_id, o.tenant_id AS tenant_id
             FROM organizations o JOIN tenants t ON t.id = o.tenant_id
             WHERE t.slug=? AND o.name=?`,
          )
          .get(TENANT_01_SLUG, DEFAULT_ORGANIZATION_NAME)
  ) as { organization_id: string; tenant_id: string } | undefined;
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
  // Fase 3B part 7: same reason as defaultOrganization() below — a plain
  // `SELECT id FROM tenants WHERE slug=?` needs tenants_select's policy to
  // pass, which a brand-new registrant never does yet. Routed through the
  // same aristo.default_organization() SECURITY DEFINER function (it
  // returns tenant_id too, so no separate function is needed just for
  // this one column).
  const tenant = (await db()
    .prepare("SELECT tenant_id AS id FROM aristo.default_organization()")
    .get()) as { id: string } | undefined;
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

export type UserScope = { tenantId: string; organizationId: string };

// Fase 2B: resolves the tenant/organization a user's *new* study data
// (items/records/plans/questions/study_sessions) should be stamped with.
// Deliberately not gated by isPostgres() internally — callers only call
// this from inside an `if (isPostgres())` branch (see study.ts), since a
// null return here means something different from "SQLite mode": it means
// "this user has no valid tenant/organization context; refuse the write"
// (see the doc comment on the call sites in study.ts).
//
// Reads tenant_members first (the authoritative source for which tenant a
// user belongs to — see syncTenantMembership) and then organization_members
// scoped to that same tenant, rather than shortcutting through
// organization_members.tenant_id alone — this keeps the tenant/organization
// hierarchy explicit even though, today, resolving either one alone would
// happen to give the same answer.
//
// Encapsulated as a single "current scope" lookup on purpose: today it can
// only ever resolve to one row each (one tenant, one active organization
// per user), but Fase 4 (switching organizations, multiple memberships)
// only has to change this one function, not every call site.
export async function resolveUserScope(
  userId: string,
): Promise<UserScope | null> {
  const tenant = (await db()
    .prepare(
      "SELECT tenant_id FROM tenant_members WHERE user_id=? AND status='active' ORDER BY joined_at ASC LIMIT 1",
    )
    .get(userId)) as { tenant_id: string } | undefined;
  if (!tenant) return null;
  const organization = (await db()
    .prepare(
      "SELECT organization_id FROM organization_members WHERE user_id=? AND tenant_id=? AND status='active' ORDER BY joined_at ASC LIMIT 1",
    )
    .get(userId, tenant.tenant_id)) as { organization_id: string } | undefined;
  if (!organization) return null;
  return { tenantId: tenant.tenant_id, organizationId: organization.organization_id };
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
  // Fase 3B part 5, batch 7: must see a link to *any* mentor, not just the
  // one who just removed their own — a self-scoped mentor_students SELECT
  // policy would hide other mentors' links here. Routed through
  // aristo.student_has_any_mentor_link(), a SECURITY DEFINER function, for
  // the same reason batch 4's has_mentor_role exists.
  const stillLinked = await db()
    .prepare("SELECT aristo.student_has_any_mentor_link(?) AS linked")
    .get(studentId);
  if ((stillLinked as { linked: boolean } | undefined)?.linked) return;
  const { organization_id } = await defaultOrganization();
  // Fase 3B pre-cutover audit: this UPDATE's organization_members RLS
  // policy requires the caller to be *this organization's* active mentor
  // (is_organization_mentor) — true for every reachable caller today,
  // since removeStudent's mentor_students link guarantees they already
  // went through addStudent, and there is only one organization per
  // tenant. Not defensively checked before now: if that invariant ever
  // breaks (multi-org support, or a mentor's own membership suspended
  // mid-flight), USING would silently exclude the row — 0 rows, no error —
  // leaving the student's membership stuck at 'active' instead of
  // 'suspended'. Not a security escalation (worst case is a stale roster
  // entry), so this only logs rather than throwing: throwing here would
  // roll back removeStudent's whole transaction, undoing the
  // mentor_students deletion that already succeeded correctly — same
  // "log, don't fail an already-successful action" choice as
  // recovery/route.ts's email-send failure.
  const result = await db()
    .prepare(
      "UPDATE organization_members SET status='suspended', updated_at=now() WHERE organization_id=? AND user_id=?",
    )
    .run(organization_id, studentId);
  if (!result.changes)
    console.error(
      "release_organization_membership_orphan_mismatch",
      { studentId, organization_id },
    );
}

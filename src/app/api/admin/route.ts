import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireUser, passwordHash } from "@/server/auth";
import { db, transaction, withActor } from "@/server/db";
import { body, failure, HttpError, json, limit } from "@/server/http";
import { isPlatformAdmin } from "@/server/authorization";
import {
  createProfile,
  ensureOrganizationMembership,
  syncTenantMembership,
} from "@/server/identity";
import type { User } from "@/lib/domain";
export const runtime = "nodejs";

// Fase 4A: same shape as mentor/route.ts's requireMentor() — no SaaS
// equivalent existed yet for platform_admin. Reuses authorization.ts's
// isPlatformAdmin() (Fase 3A), not a new check — this is the same
// predicate is_platform_admin() itself is built on.
async function requirePlatformAdmin(user: User) {
  if (!(await isPlatformAdmin(user.id)))
    throw new HttpError(403, "Área exclusiva para administradores.");
  return user;
}

type Member = { id: string; name: string; email: string; role: "student" | "mentor" };

export async function GET() {
  try {
    const authUser = await requireUser();
    // requireUser()'s actor does not reliably survive being awaited from
    // here (see auth/route.ts's change-password fix) — withActor() scopes
    // it explicitly for requirePlatformAdmin()'s own RLS-scoped check and
    // the query below.
    return await withActor(authUser.id, async () => {
      await requirePlatformAdmin(authUser);
      const members = (await db()
        .prepare(
          `SELECT u.id, u.name, u.email, u.role
           FROM users u
           JOIN tenant_members tm ON tm.user_id = u.id
           JOIN tenants t ON t.id = tm.tenant_id
           WHERE t.slug = 'mentoria-coelho' AND tm.status = 'active'
           ORDER BY u.name`,
        )
        .all()) as Member[];
      return json({ members });
    });
  } catch (e) {
    return failure(e);
  }
}

const adminMutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create-member"),
      name: z.string().trim().min(2).max(80),
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(8).max(128),
      role: z.enum(["student", "mentor"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("set-role"),
      userId: z.string().min(1).max(100),
      role: z.enum(["student", "mentor"]),
    })
    .strict(),
]);

export async function POST(request: Request) {
  try {
    const authUser = await requireUser();
    return await withActor(authUser.id, async () => {
      await requirePlatformAdmin(authUser);
      await limit("admin:" + authUser.id, 30);
      const data = adminMutation.parse(await body(request));
      if (data.action === "create-member") {
        const id = randomUUID();
        const password = await passwordHash(data.password);
        // Same atomic account+profile+membership sequence as
        // auth/route.ts's register — reused as-is, not duplicated. The
        // only difference is role is set directly (register always
        // defaults to student) and the actor is the admin, not the new
        // account: every table involved already grants is_platform_admin()
        // its own WITH CHECK clause, so this needs no new SQL function —
        // verified directly against the live database that INSERT on
        // users.role/email was never column-restricted, only UPDATE was
        // (batch 5).
        await transaction(async () => {
          const result = await db()
            .prepare(
              "INSERT OR IGNORE INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)",
            )
            .run(id, data.name, data.email, password, data.role, Date.now());
          if (!result.changes)
            throw new HttpError(409, "Já existe uma conta com esse e-mail.");
          await createProfile(id, data.name, null);
          await syncTenantMembership(id, data.role);
          await ensureOrganizationMembership(
            id,
            data.role === "mentor" ? "MENTOR" : "STUDENT",
          );
        });
        return json({ ok: true }, 201);
      }
      // set-role: users.role has no UPDATE column privilege for aristo_app
      // at all (batch 5) — aristo.set_member_role() is the one narrow,
      // gated exception, checking is_platform_admin() internally.
      await db()
        .prepare("SELECT aristo.set_member_role(?,?)")
        .get(data.userId, data.role);
      return json({ ok: true });
    });
  } catch (e) {
    return failure(e);
  }
}

import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  currentUser,
  createSession,
  passwordHash,
  passwordMatches,
  logout,
  requireUser,
} from "@/server/auth";
import { db, isPostgres, setActor, transaction } from "@/server/db";
import { body, failure, HttpError, json, limit } from "@/server/http";
import {
  createProfile,
  ensureOrganizationMembership,
  syncTenantMembership,
} from "@/server/identity";
export const runtime = "nodejs";
const credentials = z
  .object({
    action: z.enum(["login", "register"]),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
    name: z.string().trim().min(2).max(80).optional(),
  })
  .strict();
export async function GET() {
  try {
    const user = await currentUser();
    return json({ user }, user ? 200 : 401);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const input = await body(request);
    if (input?.action === "logout") {
      await logout();
      return json({ ok: true });
    }
    if (input?.action === "change-password") {
      const user = await requireUser();
      await limit("password:" + user.id, 5, 15 * 60000);
      const change = z
        .object({
          action: z.literal("change-password"),
          currentPassword: z.string().min(12).max(128),
          newPassword: z.string().min(12).max(128),
        })
        .strict()
        .parse(input);
      const row = (await db()
        .prepare("SELECT password FROM users WHERE id=?")
        .get(user.id)) as { password: string };
      if (!(await passwordMatches(change.currentPassword, row.password)))
        throw new HttpError(400, "A senha atual não confere.");
      const nextHash = await passwordHash(change.newPassword);
      await transaction(async () => {
        const result = await db()
          .prepare("UPDATE users SET password=? WHERE id=? AND password=?")
          .run(nextHash, user.id, row.password);
        if (!result.changes)
          throw new HttpError(
            409,
            "A senha mudou em outra sessão. Entre novamente.",
          );
        await db().prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        await db()
          .prepare("DELETE FROM password_resets WHERE user_id=?")
          .run(user.id);
        await createSession(user.id);
      });
      return json({ ok: true });
    }
    const data = credentials.parse(input);
    // Shared budget is deliberately conservative without trusting forwarded client IP headers.
    await limit("auth-global", 100, 15 * 60000);
    await limit("auth:" + data.email, 10, 15 * 60000);
    const connection = db();
    if (data.action === "register") {
      if (!data.name) throw new HttpError(400, "Informe seu nome.");
      const name = data.name;
      const password = await passwordHash(data.password);
      const id = randomUUID();
      // Fase 3B: nobody is "logged in" yet during registration — the new
      // account acts as itself from the moment its id is minted, so the
      // inserts below (self-row) satisfy RLS once policies exist. Until
      // then this is a no-op (nothing reads app.user_id yet).
      setActor(id);
      // Fase 0C: the account, its SaaS profile and its Tenant 01 membership
      // are created atomically — any failure rolls back the whole signup.
      await transaction(async () => {
        const result = await connection
          .prepare(
            "INSERT OR IGNORE INTO users(id,name,email,password,created_at) VALUES(?,?,?,?,?)",
          )
          .run(id, name, data.email, password, Date.now());
        if (!result.changes)
          throw new HttpError(
            409,
            "Não foi possível criar a conta com esses dados. Tente entrar.",
          );
        await createProfile(id, name, null);
        await syncTenantMembership(id, "student");
        // Fase 2 prerequisite: every account needs an active organization
        // membership to create study data once tenant_id/organization_id
        // become required (see resolveUserScope in identity.ts) — without
        // this, a student who registers but is never added by a mentor
        // would be unable to use the app at all from day one.
        await ensureOrganizationMembership(id, "STUDENT");
      });
      await createSession(id);
      return json({ ok: true }, 201);
    }
    // Fase 3B part 4: no actor exists yet at this point (finding the
    // account by email *is* the point) — SELECT id,password FROM users
    // WHERE email=? runs through aristo.verify_login_credential(), a
    // narrow SECURITY DEFINER lookup, instead of a direct users read that
    // a future self-only RLS policy would refuse. SQLite has no such
    // function (and no RLS at all), so it keeps the original direct query.
    const user = (
      isPostgres()
        ? await connection
            .prepare(
              "SELECT * FROM aristo.verify_login_credential(?)",
            )
            .get(data.email)
        : await connection
            .prepare("SELECT id,password FROM users WHERE email=?")
            .get(data.email)
    ) as { id: string; password: string } | undefined;
    const valid = await passwordMatches(
      data.password,
      user?.password || "00000000000000000000000000000000:" + "00".repeat(64),
    );
    if (!user || !valid)
      throw new HttpError(401, "E-mail ou senha incorretos.");
    // Fase 3B: the credential lookup above ran with no actor (that's what
    // it's for — see the note on the users-by-email SELECT); once the
    // password is verified, every following query in this request is
    // legitimately "this user acting as themselves".
    setActor(user.id);
    await transaction(async () => {
      const current = (await connection
        .prepare("SELECT password FROM users WHERE id=? FOR UPDATE")
        .get(user.id)) as { password: string } | undefined;
      if (!current || current.password !== user.password)
        throw new HttpError(401, "A senha foi alterada. Entre novamente.");
      await createSession(user.id);
    });
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

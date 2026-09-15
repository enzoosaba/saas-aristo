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
import { db, transaction } from "@/server/db";
import { body, failure, HttpError, json, limit } from "@/server/http";
import { createProfile, syncTenantMembership } from "@/server/identity";
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
      });
      await createSession(id);
      return json({ ok: true }, 201);
    }
    const user = (await connection
      .prepare("SELECT id,password FROM users WHERE email=?")
      .get(data.email)) as { id: string; password: string } | undefined;
    const valid = await passwordMatches(
      data.password,
      user?.password || "00000000000000000000000000000000:" + "00".repeat(64),
    );
    if (!user || !valid)
      throw new HttpError(401, "E-mail ou senha incorretos.");
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

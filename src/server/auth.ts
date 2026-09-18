import { cookies } from "next/headers";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { db, isPostgres, setActor } from "./db";
import { HttpError } from "./http";
import type { User } from "@/lib/domain";
const derive = promisify(scrypt);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, value] = stored.split(":");
  const candidate = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(value, "hex");
  return (
    expected.length === candidate.length && timingSafeEqual(expected, candidate)
  );
}
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get("aristo-session")?.value;
  if (!token) return null;
  // Fase 3B part 5, batch 5: this lookup itself necessarily runs with no
  // actor established yet (that's what it's for) — routed through
  // aristo.resolve_session_user() under Postgres, a narrow SECURITY
  // DEFINER function keyed by the exact hashed token, since a self-only
  // users RLS policy can't apply before the actor it would check against
  // is even known. SQLite keeps the original direct join (no RLS to route
  // around). Every query after this one in the same request runs as the
  // resolved user, once found.
  const user =
    ((isPostgres()
      ? await db()
          .prepare("SELECT * FROM aristo.resolve_session_user(?,?)")
          .get(hash(token), Date.now())
      : await db()
          .prepare(
            "SELECT u.id,u.name,u.email,u.role,u.avatar FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
          )
          .get(hash(token), Date.now())) as User) || null;
  if (user) setActor(user.id);
  return user;
}
// Fase 3B pre-cutover fix: setActor()/enterWith() (called inside
// currentUser() above) does not reliably survive being awaited from a
// different function's continuation — verified empirically: every db()
// call made by a caller of requireUser() after this returns saw a null
// actor, silently emptying every RLS-scoped query (or, worse, an
// RLS-scoped write) without an error. Calling setActor() again here does
// NOT fix it either (same nested-return problem) — every caller of
// requireUser()/requireMentor() MUST wrap its own subsequent logic in
// withActor(user.id, ...) (from ./db, uses AsyncLocalStorage.run()
// instead of enterWith()) rather than assuming the actor is still set.
// See src/app/api/study/route.ts and src/app/api/mentor/route.ts.
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Entre na sua conta para continuar.");
  return user;
}
export async function createSession(userId: string) {
  // Defensive: callers should already have set the actor (register mints
  // it explicitly; login resolves it right before calling this), but a
  // session is always for this exact user, so make it self-sufficient too.
  setActor(userId);
  const token = randomBytes(32).toString("hex");
  const maxAge = 60 * 60 * 24 * 7;
  await db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  await db()
    .prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)")
    .run(hash(token), userId, Date.now() + maxAge * 1000);
  (await cookies()).set("aristo-session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get("aristo-session")?.value;
  if (token)
    await db().prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
  jar.delete("aristo-session");
}

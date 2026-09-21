import { cookies } from "next/headers";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { db, isPostgres, withActor } from "./db";
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
  // around). This does NOT establish an actor for the caller: whoever gets the
  // user back must run its own queries inside withActor(user.id, ...).
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
  return user;
}
// CONTRACT: requireUser() (and currentUser()) only identify the caller; they
// do not set the actor Postgres RLS reads. Every route handler that calls them
// MUST run everything after that — including any further authorization lookup —
// inside withActor(user.id, ...) (./db, AsyncLocalStorage.run()). There used to
// be a setActor() (enterWith()) that did this inside currentUser(); it does not
// survive being awaited from the caller's continuation, so every later query ran
// with no actor and RLS silently returned nothing or updated nothing. It was
// removed, and tests/actor-context.test.mjs fails the build if it comes back or
// if an authenticated route handler does database work outside withActor().
// See src/app/api/study/route.ts and src/app/api/mentor/route.ts.
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Entre na sua conta para continuar.");
  return user;
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const maxAge = 60 * 60 * 24 * 7;
  // A session is always for this exact user (sessions_insert checks
  // user_id = current actor), so this makes itself self-sufficient.
  await withActor(userId, async () => {
    await db()
      .prepare("DELETE FROM sessions WHERE expires < ?")
      .run(Date.now());
    await db()
      .prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)")
      .run(hash(token), userId, Date.now() + maxAge * 1000);
  });
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

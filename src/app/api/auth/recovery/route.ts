import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db, isPostgres, setActor, transaction } from "@/server/db";
import { body, failure, HttpError, json, limit } from "@/server/http";
import { passwordHash, logout } from "@/server/auth";

export const runtime = "nodejs";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("request"),
      email: z.string().trim().toLowerCase().email().max(254),
    })
    .strict(),
  z
    .object({
      action: z.literal("reset"),
      token: z.string().regex(/^[a-f0-9]{64}$/),
      password: z.string().min(8).max(128),
    })
    .strict(),
]);

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await body(request));
    await limit("recovery-global", 40, 15 * 60000);
    if (input.action === "request") {
      await limit("recovery:" + input.email, 3, 15 * 60000);
      if (
        !process.env.RESEND_API_KEY ||
        !process.env.EMAIL_FROM ||
        !process.env.APP_ORIGIN
      )
        throw new HttpError(
          503,
          "A recuperação por e-mail ainda não está disponível. Entre em contato com seu mentor.",
        );
      // Fase 3B part 4: this route is inherently pre-auth (recovering a
      // password you forgot doesn't require a session) — same reasoning
      // as the login lookup, via aristo.find_user_by_email() under
      // Postgres, the original direct query under SQLite.
      const user = (
        isPostgres()
          ? await db()
              .prepare("SELECT id FROM aristo.find_user_by_email(?)")
              .get(input.email)
          : await db()
              .prepare("SELECT id FROM users WHERE email=?")
              .get(input.email)
      ) as { id: string } | undefined;
      if (user) {
        const token = randomBytes(32).toString("hex");
        await db()
          .prepare("DELETE FROM password_resets WHERE expires < ?")
          .run(Date.now());
        await db()
          .prepare(
            "INSERT INTO password_resets(token,user_id,expires) VALUES(?,?,?)",
          )
          .run(hash(token), user.id, Date.now() + 30 * 60000);
        const link = new URL(process.env.APP_ORIGIN);
        link.hash = `reset=${token}`;
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `password-reset/${hash(token)}`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: [input.email],
            subject: "Redefina sua senha — Plataforma Coelho",
            text: `Abra este link para escolher uma nova senha: ${link.toString()}\n\nO link expira em 30 minutos e só pode ser usado uma vez. Se você não pediu esta alteração, ignore este e-mail.`,
          }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);
        if (!response?.ok) {
          await db()
            .prepare("DELETE FROM password_resets WHERE token=?")
            .run(hash(token));
          // Same public response prevents disclosing whether an account exists.
          console.error("password_reset_email_failed");
        }
      }
      return json({
        message:
          "Se houver uma conta com esse e-mail, você receberá as instruções de recuperação.",
      });
    }
    const digest = hash(input.token);
    const row = (await db()
      .prepare(
        "SELECT user_id FROM password_resets WHERE token=? AND expires>?",
      )
      .get(digest, Date.now())) as { user_id: string } | undefined;
    if (!row)
      throw new HttpError(
        400,
        "Link inválido ou expirado. Solicite um novo e-mail.",
      );
    // Fase 3B part 5, batch 5: this whole flow is anonymous — gated only
    // by possession of a valid reset token, never a session — so no actor
    // was ever set for this request. Without this, the self-only users
    // UPDATE policy below would silently affect 0 rows once aristo_app is
    // the connecting role (RLS refusing the row, not an error), while this
    // handler would still report success. row.user_id is safe to trust as
    // the actor here precisely because it came from a token that was just
    // validated against password_resets above.
    setActor(row.user_id);
    const password = await passwordHash(input.password);
    await transaction(async () => {
      await db()
        .prepare("SELECT id FROM users WHERE id=? FOR UPDATE")
        .get(row.user_id);
      const consumed = await db()
        .prepare("DELETE FROM password_resets WHERE token=? AND expires>?")
        .run(digest, Date.now());
      if (!consumed.changes)
        throw new HttpError(
          400,
          "Link inválido ou expirado. Solicite um novo e-mail.",
        );
      await db()
        .prepare("UPDATE users SET password=? WHERE id=?")
        .run(password, row.user_id);
      await db()
        .prepare("DELETE FROM sessions WHERE user_id=?")
        .run(row.user_id);
      await db()
        .prepare("DELETE FROM password_resets WHERE user_id=?")
        .run(row.user_id);
    });
    await logout();
    return json({ message: "Senha atualizada. Entre com a nova senha." });
  } catch (error) {
    return failure(error);
  }
}

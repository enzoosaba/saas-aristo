import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { postgresConfig, postgresSql } from "../src/server/postgres-config.mjs";

if (!process.env.TEST_DATABASE_PATH)
  throw new Error("Execute pelo runner isolado de testes.");
const base = process.env.TEST_BASE_URL;
const pg = process.env.TEST_DATABASE_URL
  ? new Pool(
      postgresConfig({
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
      }),
    )
  : null;
const sqlite = pg ? null : new DatabaseSync(process.env.TEST_DATABASE_PATH);
const admin = async (sql, args = []) =>
  pg
    ? (await pg.query(postgresSql(sql), args)).rows
    : sqlite.prepare(sql).all(...args);
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  const password = "Entrega-Segura-2026!";
  const accounts = [];
  for (const name of ["Mentor", "Aluno", "Outro"]) {
    const ctx = await browser.newContext();
    const email = `${name.toLowerCase()}-${Date.now()}@example.test`;
    const response = await ctx.request.post(base + "/api/auth", {
      headers: { Origin: base },
      data: { action: "register", name, email, password },
    });
    assert.equal(response.status(), 201);
    const { user } = await (await ctx.request.get(base + "/api/auth")).json();
    accounts.push({ ctx, user, email });
  }
  const [mentor, student, other] = accounts;
  const post = (account, path, data) =>
    account.ctx.request.post(base + path, { headers: { Origin: base }, data });

  // Fase 0C: registration must atomically enroll the account into Tenant 01
  // (aristo.profiles + aristo.tenant_members). Postgres-only — these tables
  // do not exist under the SQLite fallback used by pnpm test:e2e.
  if (pg) {
    for (const account of [mentor, student, other]) {
      const [profile] = await admin(
        "SELECT full_name, avatar_url FROM profiles WHERE user_id=?",
        [account.user.id],
      );
      assert.ok(profile, `profile ausente para ${account.user.id}`);
      assert.equal(profile.full_name, account.user.name);
      assert.equal(profile.avatar_url, null);
      const [membership] = await admin(
        `SELECT tm.role FROM tenant_members tm
         JOIN tenants t ON t.id = tm.tenant_id
         WHERE tm.user_id=? AND t.slug='mentoria-coelho'`,
        [account.user.id],
      );
      assert.ok(membership, `tenant_members ausente para ${account.user.id}`);
      assert.equal(membership.role, "STUDENT");
    }

    // Registering the same e-mail twice must not create a second profile or
    // tenant_members row — the users insert is a no-op (0 changes), so the
    // transaction never reaches createProfile/syncTenantMembership again.
    const duplicate = await post(student, "/api/auth", {
      action: "register",
      name: student.user.name,
      email: student.email,
      password,
    });
    assert.equal(duplicate.status(), 409);
    assert.equal(
      Number(
        (
          await admin(
            "SELECT count(*) AS total FROM profiles WHERE user_id=?",
            [student.user.id],
          )
        )[0].total,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await admin(
            "SELECT count(*) AS total FROM tenant_members WHERE user_id=?",
            [student.user.id],
          )
        )[0].total,
      ),
      1,
    );

    // Editing name/avatar keeps aristo.profiles in sync with users.
    assert.equal(
      (
        await post(student, "/api/study", {
          action: "profile",
          name: "Aluno Renomeado",
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await admin("SELECT full_name FROM profiles WHERE user_id=?", [
          student.user.id,
        ])
      )[0].full_name,
      "Aluno Renomeado",
    );
    assert.equal(
      (
        await post(student, "/api/study", {
          action: "update-avatar",
          avatar: "data:image/png;base64,AAAA",
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await admin("SELECT avatar_url FROM profiles WHERE user_id=?", [
          student.user.id,
        ])
      )[0].avatar_url,
      "data:image/png;base64,AAAA",
    );
  }

  await admin("UPDATE users SET role='mentor' WHERE id=?", [mentor.user.id]);
  assert.equal(
    (await student.ctx.request.get(base + "/api/mentor")).status(),
    403,
  );
  assert.equal(
    (
      await post(mentor, "/api/mentor", {
        action: "add-student",
        email: student.email,
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await mentor.ctx.request.get(
        base + `/api/mentor?student=${other.user.id}`,
      )
    ).status(),
    404,
  );
  assert.equal(
    (
      await mentor.ctx.request.get(
        base + `/api/mentor?student=${student.user.id}&date=2026-02-30`,
      )
    ).status(),
    400,
  );
  const state = await (
    await student.ctx.request.get(base + "/api/study")
  ).json();
  const payload = {
    action: "save-plan",
    date: state.today,
    prioridades: "Entrega",
    horarios: "09:00",
    observacoes: "",
    version: 0,
  };
  const results = await Promise.all([
    post(student, "/api/study", payload),
    post(student, "/api/study", payload),
  ]);
  assert.deepEqual(results.map((r) => r.status()).sort(), [200, 409]);
  const page = await mentor.ctx.newPage();
  await page.goto(base + "/mentoria");
  await page.getByRole("heading", { name: "Espaço do mentor" }).waitFor();
  const summary = await (
    await mentor.ctx.request.get(
      base + `/api/mentor?student=${student.user.id}`,
    )
  ).json();
  assert.equal(summary.plan.prioridades, "Entrega");
  const token = randomBytes(32).toString("hex");
  const expired = randomBytes(32).toString("hex");
  await admin(
    "INSERT INTO password_resets(token,user_id,expires) VALUES(?,?,?)",
    [
      createHash("sha256").update(expired).digest("hex"),
      student.user.id,
      Date.now() - 1,
    ],
  );
  assert.equal(
    (
      await post(student, "/api/auth/recovery", {
        action: "reset",
        token: expired,
        password,
      })
    ).status(),
    400,
  );
  await admin(
    "INSERT INTO password_resets(token,user_id,expires) VALUES(?,?,?)",
    [
      createHash("sha256").update(token).digest("hex"),
      student.user.id,
      Date.now() + 60000,
    ],
  );
  const studentPage = await student.ctx.newPage();
  await studentPage.goto(base + "/#reset=" + token);
  await studentPage
    .getByLabel("Nova senha", { exact: true })
    .fill("Senha-Nova-Entrega-2026!");
  await studentPage
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill("Senha-Nova-Entrega-2026!");
  await studentPage.getByRole("button", { name: "Salvar nova senha" }).click();
  await studentPage
    .getByText("Senha atualizada. Entre com a nova senha.", { exact: true })
    .waitFor();
  assert.ok(!studentPage.url().includes(token));
  assert.equal(
    (
      await post(student, "/api/auth/recovery", {
        action: "reset",
        token,
        password,
      })
    ).status(),
    400,
  );
  assert.equal(
    (await student.ctx.request.get(base + "/api/study")).status(),
    401,
  );
  assert.equal(
    (
      await post(student, "/api/auth", {
        action: "login",
        email: student.email,
        password: "Senha-Nova-Entrega-2026!",
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await post(mentor, "/api/mentor", {
        action: "remove-student",
        studentId: student.user.id,
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await mentor.ctx.request.get(
        base + `/api/mentor?student=${student.user.id}`,
      )
    ).status(),
    404,
  );
  console.log(
    "Delivery: mentor permissions, valid dates, concurrent writes, recovery UI, one-time tokens, revocation, login and Tenant 01 identity sync passed.",
  );
} finally {
  await browser.close();
  sqlite?.close();
  await pg?.end();
}

import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  for (const name of ["Mentor", "Aluno", "Outro", "ModeloNovo"]) {
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
  const [mentor, student, other, modeloNovo] = accounts;
  const post = (account, path, data) =>
    account.ctx.request.post(base + path, { headers: { Origin: base }, data });

  // Fase 3A: requireMentor() must work through the new SaaS model alone,
  // not only via the users.role fallback. "modeloNovo" registers as a
  // plain student (users.role stays 'student') and is never promoted the
  // legacy way — only organization_members.member_role is set directly,
  // proving the new model is genuinely consulted, not just present in code.
  if (pg) {
    assert.equal(
      (await modeloNovo.ctx.request.get(base + "/api/mentor")).status(),
      403,
      "sem MENTOR em nenhum modelo, deve continuar bloqueado",
    );
    await admin(
      "UPDATE organization_members SET member_role='MENTOR' WHERE user_id=?",
      [modeloNovo.user.id],
    );
    assert.equal(
      (await modeloNovo.ctx.request.get(base + "/api/mentor")).status(),
      200,
      "MENTOR em organization_members deve bastar, mesmo com users.role ainda 'student'",
    );
    const [row] = await admin("SELECT role FROM users WHERE id=?", [
      modeloNovo.user.id,
    ]);
    assert.equal(
      row.role,
      "student",
      "users.role não foi tocado — o modelo novo decidiu sozinho",
    );
  }

  // Fase 2B: every new item/record/plan/question/study_session must be
  // stamped with the creating user's own tenant/organization scope —
  // resolved server-side from tenant_members/organization_members, never
  // supplied by the client. Postgres-only, same as the rest of the SaaS
  // foundation (these columns don't exist under the SQLite fallback).
  if (pg) {
    const scopeOf = async (userId) => {
      const [row] = await admin(
        `SELECT tm.tenant_id AS tenant_id, om.organization_id AS organization_id
         FROM tenant_members tm
         JOIN organization_members om
           ON om.user_id = tm.user_id AND om.tenant_id = tm.tenant_id AND om.status = 'active'
         WHERE tm.user_id = ? AND tm.status = 'active'`,
        [userId],
      );
      return row;
    };

    const studentScope = await scopeOf(student.user.id);
    const otherScope = await scopeOf(other.user.id);
    assert.ok(studentScope, "aluno deve ter escopo ativo logo após o registro");
    assert.ok(otherScope, "outro aluno deve ter escopo ativo logo após o registro");

    const { today } = await (await student.ctx.request.get(base + "/api/study")).json();

    const itemId = randomUUID();
    assert.equal(
      (
        await post(student, "/api/study", {
          action: "save-item",
          item: {
            id: itemId,
            kind: "habit",
            title: "Ler 10 páginas",
            notes: "",
            frequency: "Todos os dias",
            measure: "check",
            target: 1,
            unit: "",
            date: today,
            time: "",
            priority: "Normal",
            value: 0,
            done: false,
          },
        })
      ).status(),
      200,
    );
    const [itemRow] = await admin(
      "SELECT tenant_id, organization_id FROM items WHERE id=?",
      [itemId],
    );
    assert.deepEqual(itemRow, studentScope, "novo item recebe escopo correto");

    assert.equal(
      (
        await post(student, "/api/study", {
          action: "record",
          id: itemId,
          date: today,
          value: 0,
          done: true,
          version: 0,
        })
      ).status(),
      200,
    );
    const [recordRow] = await admin(
      "SELECT tenant_id, organization_id FROM records WHERE user_id=? AND item_id=?",
      [student.user.id, itemId],
    );
    assert.deepEqual(recordRow, studentScope, "novo record recebe escopo correto");

    // A different date than "today": a later check in this same script
    // exercises save-plan for "today" (concurrent-write test) and must not
    // collide with this one.
    const planDate = "2020-01-01";
    assert.equal(
      (
        await post(student, "/api/study", {
          action: "save-plan",
          date: planDate,
          prioridades: "Revisar",
          horarios: "",
          observacoes: "",
          version: 0,
        })
      ).status(),
      200,
    );
    const [planRow] = await admin(
      "SELECT tenant_id, organization_id FROM plans WHERE user_id=? AND date=?",
      [student.user.id, planDate],
    );
    assert.deepEqual(planRow, studentScope, "novo plan recebe escopo correto");

    const questionId = randomUUID();
    assert.equal(
      (
        await post(student, "/api/study", {
          action: "save-question",
          question: {
            id: questionId,
            subject: "Matemática",
            topic: "Frações",
            date: today,
            total: 10,
            correct: 7,
            version: 0,
          },
        })
      ).status(),
      200,
    );
    const [questionRow] = await admin(
      "SELECT tenant_id, organization_id FROM questions WHERE id=?",
      [questionId],
    );
    assert.deepEqual(questionRow, studentScope, "nova question recebe escopo correto");

    const sessionId = randomUUID();
    assert.equal(
      (
        await post(student, "/api/study", {
          action: "save-session",
          session: {
            id: sessionId,
            title: "Estudo dirigido",
            subject: "Matemática",
            date: today,
            start: "08:00",
            duration: 60,
            notes: "",
            version: 0,
          },
        })
      ).status(),
      200,
    );
    const [sessionRow] = await admin(
      "SELECT tenant_id, organization_id FROM study_sessions WHERE id=?",
      [sessionId],
    );
    assert.deepEqual(sessionRow, studentScope, "nova study_session recebe escopo correto");

    // "other" independently resolves to the same tenant/organization (only
    // one exists today) but through its own membership row, not by copying
    // student's — proving this isn't a hardcoded/shared constant.
    const otherItemId = randomUUID();
    assert.equal(
      (
        await post(other, "/api/study", {
          action: "save-item",
          item: {
            id: otherItemId,
            kind: "habit",
            title: "Revisar exercícios",
            notes: "",
            frequency: "Todos os dias",
            measure: "check",
            target: 1,
            unit: "",
            date: today,
            time: "",
            priority: "Normal",
            value: 0,
            done: false,
          },
        })
      ).status(),
      200,
    );
    const [otherItemRow] = await admin(
      "SELECT tenant_id, organization_id FROM items WHERE id=?",
      [otherItemId],
    );
    assert.deepEqual(
      otherItemRow,
      otherScope,
      "dados de outro usuário usam o escopo dele, não um valor fixo emprestado",
    );
    assert.notEqual(
      itemId,
      otherItemId,
      "cada usuário tem seu próprio registro, não compartilhado por engano",
    );
  }

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

  // Fase 1C: adding a student must atomically sync organization_members
  // for both sides, using Tenant 01's default organization ("Turma
  // Inicial"). Postgres-only, same as the rest of the SaaS foundation.
  const membership = async (userId) =>
    (
      await admin(
        "SELECT member_role, status FROM organization_members WHERE user_id=?",
        [userId],
      )
    )[0];
  if (pg) {
    assert.deepEqual(await membership(mentor.user.id), {
      member_role: "MENTOR",
      status: "active",
    });
    assert.deepEqual(await membership(student.user.id), {
      member_role: "STUDENT",
      status: "active",
    });

    // adding the same student again must not duplicate either link
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
      Number(
        (
          await admin(
            "SELECT count(*) AS total FROM organization_members WHERE user_id=?",
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
            "SELECT count(*) AS total FROM mentor_students WHERE mentor_id=? AND student_id=?",
            [mentor.user.id, student.user.id],
          )
        )[0].total,
      ),
      1,
    );

    // a second mentor also links the same student, for the removal checks below
    await admin("UPDATE users SET role='mentor' WHERE id=?", [other.user.id]);
    assert.equal(
      (
        await post(other, "/api/mentor", {
          action: "add-student",
          email: student.email,
        })
      ).status(),
      200,
    );
    assert.deepEqual(await membership(other.user.id), {
      member_role: "MENTOR",
      status: "active",
    });

    // roles incorretas são rejeitadas: the CHECK constraint on
    // organization_members.member_role still protects the database even if
    // application code ever tried something outside MENTOR/STUDENT. Uses a
    // second, otherwise-unused organization so this only exercises the
    // CHECK constraint, not the (organization_id,user_id) UNIQUE one.
    const [tenantRow] = await admin(
      "SELECT id FROM tenants WHERE slug='mentoria-coelho'",
    );
    await admin(
      "INSERT INTO organizations(tenant_id,name) VALUES(?,?)",
      [tenantRow.id, "Turma Secundária"],
    );
    const [otherOrgRow] = await admin(
      "SELECT id FROM organizations WHERE name='Turma Secundária'",
    );
    await assert.rejects(
      pg.query(
        "INSERT INTO aristo.organization_members(tenant_id,organization_id,user_id,member_role) VALUES($1,$2,$3,'TENANT_ADMIN')",
        [tenantRow.id, otherOrgRow.id, other.user.id],
      ),
      /check/i,
    );
  }

  // Still 404 regardless of Postgres/organization sync above: this checks
  // the mentor_students ownership link, which "other" was never added to
  // (only promoted to mentor for the removal checks further down).
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

  if (pg) {
    // "other" still links the student (added earlier): losing only the
    // "mentor" link must not suspend the organization membership.
    assert.deepEqual(await membership(student.user.id), {
      member_role: "STUDENT",
      status: "active",
    });

    // removing the last remaining link suspends the membership
    assert.equal(
      (
        await post(other, "/api/mentor", {
          action: "remove-student",
          studentId: student.user.id,
        })
      ).status(),
      200,
    );
    assert.deepEqual(await membership(student.user.id), {
      member_role: "STUDENT",
      status: "suspended",
    });

    // Fase 2B: while suspended (no active organization membership), the
    // student cannot create new study data — refused explicitly (403), not
    // silently written as an orphan row.
    const orphanId = randomUUID();
    const orphanAttempt = await post(student, "/api/study", {
      action: "save-item",
      item: {
        id: orphanId,
        kind: "habit",
        title: "Não deveria salvar",
        notes: "",
        frequency: "Todos os dias",
        measure: "check",
        target: 1,
        unit: "",
        date: (await (await student.ctx.request.get(base + "/api/study")).json()).today,
        time: "",
        priority: "Normal",
        value: 0,
        done: false,
      },
    });
    assert.equal(orphanAttempt.status(), 403);
    assert.equal(
      Number(
        (await admin("SELECT count(*) AS total FROM items WHERE id=?", [orphanId]))[0]
          .total,
      ),
      0,
    );

    // mentors are never released by removeStudent, with or without students left
    assert.deepEqual(await membership(mentor.user.id), {
      member_role: "MENTOR",
      status: "active",
    });
    assert.deepEqual(await membership(other.user.id), {
      member_role: "MENTOR",
      status: "active",
    });

    // re-adding reactivates the suspended membership instead of duplicating
    assert.equal(
      (
        await post(mentor, "/api/mentor", {
          action: "add-student",
          email: student.email,
        })
      ).status(),
      200,
    );
    assert.deepEqual(await membership(student.user.id), {
      member_role: "STUDENT",
      status: "active",
    });
    assert.equal(
      Number(
        (
          await admin(
            "SELECT count(*) AS total FROM organization_members WHERE user_id=?",
            [student.user.id],
          )
        )[0].total,
      ),
      1,
    );
  }

  console.log(
    "Delivery: mentor permissions, valid dates, concurrent writes, recovery UI, one-time tokens, revocation, login, Tenant 01 identity sync, organization_members sync and business-data tenant/organization scoping passed.",
  );
} finally {
  await browser.close();
  sqlite?.close();
  await pg?.end();
}

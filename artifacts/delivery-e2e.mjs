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

  // Fase 3B.3-bis: prove — with real concurrent HTTP requests against the
  // real running server, not a simulated/sequential check — that the
  // AsyncLocalStorage-based actor context (setActor via enterWith() in
  // currentUser(), see src/server/auth.ts) never leaks between requests
  // from different users landing in the same Node process at the same
  // time. This is the Node-side half of the isolation guarantee; the
  // Postgres-side half (SET LOCAL never leaking across a reused pooled
  // connection) was already verified directly against Supabase.
  {
    const identified = [mentor, student, other, modeloNovo];
    const rounds = 20;
    const requests = [];
    for (let round = 0; round < rounds; round++)
      for (const account of identified)
        requests.push(
          account.ctx.request
            .get(base + "/api/study")
            .then((r) => r.json())
            .then((responseBody) => ({
              account: account.user.name,
              expected: account.user.id,
              actual: responseBody.user?.id,
            })),
        );
    // Promise.all, not sequential awaits: all ~80 requests are in flight
    // together, genuinely interleaved in the same event loop turn.
    const results = await Promise.all(requests);
    const mismatches = results.filter((r) => r.expected !== r.actual);
    assert.equal(
      mismatches.length,
      0,
      `vazamento de contexto entre requisições concorrentes: ${JSON.stringify(mismatches.slice(0, 5))}`,
    );

    // Same proof on the write side: concurrent mutations from two
    // different users landing with the correct owner AND (under Postgres)
    // the correct resolved tenant/organization scope — not just that
    // reads come back right, but that the actor threaded into an actual
    // transaction/INSERT is never swapped between concurrent writers.
    const idA = randomUUID();
    const idB = randomUUID();
    const { today: concurrencyDate } = await (
      await mentor.ctx.request.get(base + "/api/study")
    ).json();
    const makeItem = (id, title) => ({
      action: "save-item",
      item: {
        id,
        kind: "habit",
        title,
        notes: "",
        frequency: "Todos os dias",
        measure: "check",
        target: 1,
        unit: "",
        date: concurrencyDate,
        time: "",
        priority: "Normal",
        value: 0,
        done: false,
      },
    });
    const [statusA, statusB] = await Promise.all([
      post(mentor, "/api/study", makeItem(idA, "Item concorrente A")),
      post(student, "/api/study", makeItem(idB, "Item concorrente B")),
    ]);
    assert.equal(statusA.status(), 200);
    assert.equal(statusB.status(), 200);
    if (pg) {
      const [rowA] = await admin("SELECT user_id FROM items WHERE id=?", [idA]);
      const [rowB] = await admin("SELECT user_id FROM items WHERE id=?", [idB]);
      assert.equal(rowA.user_id, mentor.user.id);
      assert.equal(rowB.user_id, student.user.id);
    }
  }

  // Fase 3B part 4: routing the login lookup through
  // aristo.verify_login_credential() must not open (or widen) a
  // side-channel for enumerating which emails have an account — a
  // nonexistent email and a real email with the wrong password have to
  // remain indistinguishable in status and response body. (Timing safety
  // itself comes from the code always calling passwordMatches() against a
  // fixed dummy hash when no user is found — unchanged by this refactor;
  // this checks the observable HTTP contract, not wall-clock timing, which
  // isn't reliable to assert on in a shared CI runner.)
  {
    const bogusEmail = `no-such-account-${Date.now()}@example.test`;
    const anyPassword = "Qualquer-Senha-1234567!";
    const [unknownEmailResponse, wrongPasswordResponse] = await Promise.all([
      fetch(base + "/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify({
          action: "login",
          email: bogusEmail,
          password: anyPassword,
        }),
      }),
      fetch(base + "/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify({
          action: "login",
          email: student.email,
          password: anyPassword,
        }),
      }),
    ]);
    assert.equal(unknownEmailResponse.status, 401);
    assert.equal(wrongPasswordResponse.status, 401);
    const [unknownEmailBody, wrongPasswordBody] = await Promise.all([
      unknownEmailResponse.json(),
      wrongPasswordResponse.json(),
    ]);
    assert.deepEqual(
      unknownEmailBody,
      wrongPasswordBody,
      "e-mail inexistente e senha errada devem ser indistinguíveis na resposta",
    );
  }

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
  const privateSessionTitle = "Redação sobre assunto pessoal";
  if (!pg) {
    assert.equal(
      (
        await post(student, "/api/study", {
          action: "save-session",
          session: {
            id: randomUUID(),
            title: privateSessionTitle,
            subject: "Redação",
            date: state.today,
            start: "08:00",
            duration: 60,
            notes: "",
            version: 0,
          },
        })
      ).status(),
      200,
    );
  }
  const ownStudyState = await (
    await student.ctx.request.get(base + "/api/study")
  ).json();
  const ownSession = ownStudyState.sessions.find(
    (session) => session.date === state.today,
  );
  assert.ok(ownSession, "a sessão salva deve voltar para o próprio aluno");
  const expectedSession = pg
    ? {
        title: "Estudo dirigido",
        subject: "Matemática",
        start: "08:00",
        duration: 60,
      }
    : {
        title: privateSessionTitle,
        subject: "Redação",
        start: "08:00",
        duration: 60,
      };
  assert.equal(ownSession.title, expectedSession.title);
  const ownSessionPage = await student.ctx.newPage();
  await ownSessionPage.goto(base + "/planos");
  await ownSessionPage
    .getByRole("button", {
      name: new RegExp(`Editar sessão ${expectedSession.title}`),
    })
    .waitFor();
  await ownSessionPage.close();
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
  assert.deepEqual(summary.sessions, [
    {
      subject: expectedSession.subject,
      start: expectedSession.start,
      duration: expectedSession.duration,
    },
  ]);
  assert.equal(
    summary.sessions.some((session) => Object.hasOwn(session, "title")),
    false,
    "a resposta do mentor não pode serializar a chave title",
  );
  assert.equal(
    JSON.stringify(summary.sessions).includes(expectedSession.title),
    false,
    "a resposta do mentor não pode conter o nome privado em outro campo",
  );
  assert.equal(summary.doneCount, pg ? 1 : 0);
  assert.equal(summary.totalCount, pg ? 2 : 1);
  assert.equal(summary.xp, pg ? 20 : 0);
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

  // Fase 4A: the Torre de Controle's "Redefinir senha", end to end through the
  // real route and page (Postgres only: platform_admins and
  // aristo.admin_reset_password() do not exist in SQLite).
  if (pg) {
    const mk = async (name) => {
      const ctx = await browser.newContext();
      const email = `${name.toLowerCase()}-${Date.now()}@example.test`;
      assert.equal(
        (
          await ctx.request.post(base + "/api/auth", {
            headers: { Origin: base },
            data: { action: "register", name, email, password },
          })
        ).status(),
        201,
      );
      const { user } = await (await ctx.request.get(base + "/api/auth")).json();
      return { ctx, user, email };
    };
    const boss = await mk("BossReset");
    const victim = await mk("VictimReset");
    const bystander = await mk("BystanderReset");
    await admin("INSERT INTO platform_admins(user_id) VALUES (?)", [
      boss.user.id,
    ]);
    const resetCall = (who, userId, newPassword) =>
      post(who, "/api/admin", {
        action: "reset-password",
        userId,
        password: newPassword,
      });
    const loginStatus = async (email, pass) => {
      const fresh = await browser.newContext();
      const status = (
        await fresh.request.post(base + "/api/auth", {
          headers: { Origin: base },
          data: { action: "login", email, password: pass },
        })
      ).status();
      await fresh.close();
      return status;
    };
    const sessionStatus = async (who) =>
      (await who.ctx.request.get(base + "/api/study")).status();

    // Not an admin: refused, and the target's password is untouched.
    assert.equal(
      (await resetCall(victim, bystander.user.id, "Invasor-Senha-2026")).status(),
      403,
    );
    assert.equal(await loginStatus(bystander.email, password), 200);
    assert.equal(await loginStatus(bystander.email, "Invasor-Senha-2026"), 401);

    // Admin, invalid requests: short password, own account, unknown id.
    assert.equal(
      (await resetCall(boss, victim.user.id, "curta12")).status(),
      400,
    );
    assert.equal(
      (await resetCall(boss, boss.user.id, "Outra-Senha-2026")).status(),
      400,
    );
    assert.equal(
      (await resetCall(boss, randomUUID(), "Outra-Senha-2026")).status(),
      404,
    );
    assert.equal(await sessionStatus(victim), 200);
    assert.equal(await sessionStatus(boss), 200);

    // Admin, through the page: the same flow the person will use.
    const adminPage = await boss.ctx.newPage();
    await adminPage.goto(base + "/admin");
    await adminPage
      .getByRole("button", { name: "Redefinir senha de VictimReset" })
      .click();
    const form = adminPage.getByRole("form", {
      name: "Redefinir senha de VictimReset",
    });
    await form.getByLabel("Nova senha temporária").fill("Temporaria-2026!");
    await form.getByRole("button", { name: "Redefinir senha", exact: true }).click();
    await adminPage.getByText("Senha de VictimReset redefinida.").waitFor();

    // The account was signed out everywhere, the old password is dead, the new
    // one works — and nobody else is affected, including the admin.
    assert.equal(await sessionStatus(victim), 401);
    assert.equal(await loginStatus(victim.email, password), 401);
    assert.equal(await loginStatus(victim.email, "Temporaria-2026!"), 200);
    assert.equal(await sessionStatus(bystander), 200);
    assert.equal(await sessionStatus(boss), 200);
    assert.equal(await loginStatus(bystander.email, password), 200);

    // set-role: an id that matches nobody is a 404 (aristo.set_member_role()
    // returns nothing, so it used to look like success); a real one still works.
    assert.equal(
      (
        await post(boss, "/api/admin", {
          action: "set-role",
          userId: randomUUID(),
          role: "mentor",
        })
      ).status(),
      404,
    );
    assert.equal(
      (
        await post(boss, "/api/admin", {
          action: "set-role",
          userId: victim.user.id,
          role: "mentor",
        })
      ).status(),
      200,
    );
    assert.equal(
      (await admin("SELECT role FROM users WHERE id=?", [victim.user.id]))[0]
        .role,
      "mentor",
    );

    // Audit trail: the three sensitive admin actions each leave one row
    // (who, what, on whom, tenant, before/after) — and nothing else does: not the
    // refused attempts above (403 by a non-admin, 400/404 by the admin), and no
    // password, hash or token in any of it.
    const temporaryPassword = "Senha-Auditoria-2026!";
    const auditedEmail = `audit-created-${Date.now()}@example.test`;
    assert.equal(
      (
        await post(boss, "/api/admin", {
          action: "create-member",
          name: "AuditCriado",
          email: auditedEmail,
          password: temporaryPassword,
          role: "student",
        })
      ).status(),
      201,
    );
    const createdId = (
      await admin("SELECT id FROM users WHERE email=?", [auditedEmail])
    )[0].id;
    const trailSql =
      "SELECT user_id, action, entity_type, entity_id, tenant_id, old_value, new_value, created_at FROM audit_logs WHERE user_id=? ORDER BY id";
    const trail = await admin(trailSql, [boss.user.id]);
    assert.deepEqual(
      trail.map((r) => r.action),
      ["admin.reset-password", "admin.set-role", "admin.create-member"],
      "one row per successful admin action, none for the refused ones",
    );
    assert.deepEqual(
      trail.map((r) => r.entity_id),
      [victim.user.id, victim.user.id, createdId],
    );
    assert.ok(trail.every((r) => r.entity_type === "user" && r.tenant_id));
    assert.ok(
      trail.every((r) => Date.now() - new Date(r.created_at).getTime() < 10 * 60000),
    );
    assert.deepEqual(trail[1].old_value, { role: "student" });
    assert.deepEqual(trail[1].new_value, { role: "mentor" });
    assert.deepEqual(trail[2].new_value, {
      email: auditedEmail,
      name: "AuditCriado",
      role: "student",
    });
    assert.equal(
      (await admin("SELECT count(*) AS n FROM audit_logs WHERE user_id=?", [victim.user.id]))[0].n.toString(),
      "0",
      "a non-admin's refused attempt writes nothing",
    );
    const everything = JSON.stringify(await admin("SELECT * FROM audit_logs"));
    for (const secret of [temporaryPassword, "Temporaria-2026!", password])
      assert.ok(!everything.includes(secret), "no password in the audit log");
    assert.ok(!/[0-9a-f]{32}:[0-9a-f]{128}/.test(everything), "no password hash in the audit log");

    // A broken audit log must not undo, or fail, an action that already happened.
    await admin("ALTER TABLE aristo.audit_logs RENAME TO audit_logs_offline");
    try {
      assert.equal(
        (
          await post(boss, "/api/admin", {
            action: "set-role",
            userId: victim.user.id,
            role: "student",
          })
        ).status(),
        200,
      );
    } finally {
      await admin("ALTER TABLE aristo.audit_logs_offline RENAME TO audit_logs");
    }
    assert.equal(
      (await admin("SELECT role FROM users WHERE id=?", [victim.user.id]))[0].role,
      "student",
      "the role change stands even though its audit row could not be written",
    );
    assert.equal(
      (await admin(trailSql, [boss.user.id])).length,
      3,
      "and no row appeared for it",
    );
    await adminPage.close();
    for (const who of [boss, victim, bystander]) await who.ctx.close();
  }

  console.log(
    "Delivery: mentor permissions, valid dates, concurrent writes, recovery UI, one-time tokens, revocation, login, Tenant 01 identity sync, organization_members sync and business-data tenant/organization scoping passed.",
  );
  if (pg)
    console.log(
      "Delivery (Postgres only): admin password reset, set-role 404, and the audit trail (one row per admin action, none for refused ones, no secrets, survives a broken log) — passed.",
    );
} finally {
  await browser.close();
  sqlite?.close();
  await pg?.end();
}

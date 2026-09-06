import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.TEST_BASE_URL || "http://localhost:3100";
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const checks = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const email = `student-${Date.now()}@example.test`;
let password = "Teste-Seguro-2026!";
async function api(data, ctx = context) {
  return ctx.request.post(base + "/api/study", {
    headers: { Origin: base },
    data,
  });
}
async function state() {
  const response = await context.request.get(base + "/api/study");
  assert.equal(response.status(), 200);
  return response.json();
}
try {
  await page.goto(base);
  await page
    .getByRole("button", { name: "Criar minha conta", exact: true })
    .click();
  await page.getByLabel("Seu nome", { exact: true }).fill("Aluno Teste");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByRole("heading", { name: "Olá, Aluno" }).waitFor();
  checks.push("registration and authenticated dashboard");
  await page
    .getByRole("button", { name: "Adicionar hábito ou tarefa" })
    .click();
  await page.locator(".quick-add-options button").first().click();
  await page.getByLabel("Nome", { exact: true }).fill("Leitura E2E");
  await page.getByLabel("Como acompanhar").selectOption("count");
  await page.getByLabel("Meta", { exact: true }).fill("2");
  await page.getByLabel("Unidade", { exact: true }).fill("páginas");
  await page.getByRole("button", { name: "Criar hábito", exact: true }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.goto(base + "/rotina");
  await page.getByRole("button", { name: "Aumentar Leitura E2E" }).click();
  await page.getByText("1 / 2 páginas", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Aumentar Leitura E2E" }).click();
  await page.getByText("2 / 2 páginas", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("2 / 2 páginas", { exact: true }).waitFor();
  assert.equal((await state()).records.filter((r) => r.done).length, 1);
  checks.push("habit creation, completion and reload persistence");
  await page.getByRole("button", { name: "Editar Leitura E2E" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Leitura revisada");
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.getByText("Leitura revisada", { exact: true }).waitFor();
  checks.push("editing an existing item");
  let s = await state();
  const item = s.items[0];
  const response = await api({
    action: "save-item",
    item: { ...item, title: "Conflito", version: item.version - 1 },
  });
  assert.equal(response.status(), 409);
  checks.push("optimistic concurrency rejects stale edits");
  const other = await browser.newContext();
  await other.request.post(base + "/api/auth", {
    headers: { Origin: base },
    data: {
      action: "register",
      name: "Outro Aluno",
      email: `other-${Date.now()}@example.test`,
      password,
    },
  });
  const hidden = await api(
    { action: "archive-item", id: item.id, version: item.version },
    other,
  );
  assert.equal(hidden.status(), 404);
  assert.equal(
    (await (await other.request.get(base + "/api/study")).json()).items.length,
    0,
  );
  await other.close();
  checks.push("cross-account ownership enforcement");
  assert.equal(
    (
      await context.request.post(base + "/api/study", {
        headers: { Origin: "https://external.invalid" },
        data: { action: "profile", name: "Intruso" },
      })
    ).status(),
    403,
  );
  assert.equal((await api({ action: "profile", name: "" })).status(), 400);
  checks.push("origin and schema validation");
  const tomorrow = new Date(s.today + "T12:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  assert.equal(
    (
      await api({
        action: "record",
        id: item.id,
        date: tomorrow.toISOString().slice(0, 10),
        value: 2,
        done: true,
        version: 0,
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await api({
        action: "save-plan",
        date: "2026-02-30",
        prioridades: "",
        horarios: "",
        observacoes: "",
        version: 0,
      })
    ).status(),
    400,
  );
  const yesterday = new Date(s.today + "T12:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const past = yesterday.toISOString().slice(0, 10);
  assert.equal(
    (
      await api({ action: "save-item", item: { ...item, date: past } })
    ).status(),
    200,
  );
  assert.equal(
    (
      await api({
        action: "record",
        id: item.id,
        date: past,
        value: 1,
        done: false,
        version: 0,
      })
    ).status(),
    200,
  );
  const history = (await state()).records.filter((r) => r.itemId === item.id);
  assert.equal(history.find((r) => r.date === past).value, 1);
  assert.equal(history.find((r) => r.date === s.today).value, 2);
  checks.push("daily history isolation and invalid/future dates");

  await page.goto(base + "/planos");
  await page
    .getByLabel("Prioridades do dia", { exact: true })
    .fill("Revisar Matemática");
  await page.getByRole("button", { name: "Salvar planejamento" }).click();
  await page.getByText("Planejamento salvo na sua conta.").waitFor();
  await page.reload();
  assert.equal(
    await page.getByLabel("Prioridades do dia", { exact: true }).inputValue(),
    "Revisar Matemática",
  );
  await page.getByLabel("Dia do planejamento").fill("2026-10-01");
  assert.equal(
    await page.getByLabel("Prioridades do dia", { exact: true }).inputValue(),
    "",
  );
  checks.push("dated plans remain independent and persisted");
  await page.route("**/api/study", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page
    .getByLabel("Prioridades do dia", { exact: true })
    .fill("Rascunho preservado");
  await page.getByRole("button", { name: "Salvar planejamento" }).click();
  await page.locator("form [role=alert]").waitFor();
  assert.equal(
    await page.getByLabel("Prioridades do dia", { exact: true }).inputValue(),
    "Rascunho preservado",
  );
  await page.unroute("**/api/study");
  checks.push("network failure preserves form draft");
  await page.goto(base + "/rotina");
  await page
    .getByRole("button", { name: "Adicionar hábito ou tarefa" })
    .click();
  await page.locator(".quick-add-options button").last().click();
  await page.getByLabel("Nome", { exact: true }).fill("Revisão diária");
  await page.getByRole("button", { name: "Criar tarefa", exact: true }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.goto(base + "/calendario");
  await page.getByText("Revisão diária", { exact: true }).waitFor();
  checks.push("new task appears in the calendar");
  for (const width of [320, 390, 768, 1100, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["/", "/rotina", "/planos", "/calendario", "/perfil"]) {
      await page.goto(base + route);
      await page.locator(".app-shell").waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${width} ${route}`,
      );
    }
  }
  checks.push("five routes across five responsive widths");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole("button", { name: "Ativar tema claro" }).click();
  await page.reload();
  await page.locator(".app-shell").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/mobile-light.png",
    fullPage: true,
  });
  checks.push("theme persists after reload");
  await page.goto(base + "/rotina");
  await page.getByRole("button", { name: "Arquivar Leitura revisada" }).click();
  await page.getByRole("button", { name: "Confirmar arquivamento" }).click();
  await page
    .getByText("Leitura revisada", { exact: true })
    .waitFor({ state: "hidden" });
  s = await state();
  assert.equal(
    s.items.some((i) => i.id === item.id),
    false,
  );
  assert.equal(
    s.records.filter((r) => r.itemId === item.id && r.done).length,
    1,
  );
  checks.push("archive preserves activity history");
  await page.goto(base + "/perfil");
  await page.getByLabel("Nome do perfil").fill("Aluno Atualizado");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await page.getByText("Perfil atualizado.").waitFor();
  assert.equal((await state()).user.name, "Aluno Atualizado");

  const secondSession = await browser.newContext();
  await secondSession.request.post(base + "/api/auth", {
    headers: { Origin: base },
    data: { action: "login", email, password },
  });
  await page.getByLabel("Senha atual", { exact: true }).fill(password);
  password = "Nova-Senha-Segura-2026!";
  await page.getByLabel("Nova senha", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Alterar senha", exact: true })
    .click();
  await page
    .getByText("Senha alterada. As outras sessões foram encerradas.")
    .waitFor();
  assert.equal(
    (await secondSession.request.get(base + "/api/study")).status(),
    401,
  );
  await secondSession.close();
  checks.push("password change revokes other sessions");
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await page.getByRole("heading", { name: "Bom ter você aqui." }).waitFor();
  assert.equal((await context.request.get(base + "/api/study")).status(), 401);
  checks.push("profile editing, logout and session revocation");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("Senha-incorreta-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByText("E-mail ou senha incorretos.").waitFor();
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.locator(".app-shell").waitFor();
  await page.goto(base);
  await page.getByRole("heading", { name: "Olá, Aluno" }).waitFor();
  checks.push("invalid password and successful reauthentication");
  assert.deepEqual(errors, []);
  writeFileSync(
    "test-results/functional-report.json",
    JSON.stringify({ passed: checks.length, checks, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: checks.length, checks, errors }, null, 2),
  );
} catch (error) {
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/failure.png", fullPage: true });
  console.error({ checks, error });
  process.exitCode = 1;
} finally {
  await browser.close();
}

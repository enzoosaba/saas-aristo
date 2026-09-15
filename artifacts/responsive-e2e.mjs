import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.TEST_BASE_URL || "http://localhost:3104";
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
const errors = [];
const results = [];
page.on("pageerror", (e) => errors.push(e.message));
const post = (data) =>
  ctx.request.post(base + "/api/study", { headers: { Origin: base }, data });
const state = async () => (await ctx.request.get(base + "/api/study")).json();
mkdirSync("test-results/responsive", { recursive: true });
try {
  await ctx.request.post(base + "/api/auth", {
    headers: { Origin: base },
    data: {
      action: "register",
      name: "Aluno Responsivo",
      email: `responsive${Date.now()}@example.test`,
      password: "Testando-2026!",
    },
  });
  let s = await state();
  await page.goto(base + "/questoes");
  await page.getByLabel("Matéria / área").selectOption("Matemática");
  await page
    .getByLabel("Tópico", { exact: true })
    .fill("Geometria plana e interpretação de situações-problema");
  await page.getByLabel("Questões respondidas").fill("10");
  await page.getByLabel("Acertos", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Salvar registro" }).click();
  await page
    .getByText("Registro salvo. Seu desempenho foi atualizado.")
    .waitFor();
  s = await state();
  assert.equal(s.questions[0].correct, 8);
  const q = s.questions[0];
  assert.equal(
    (
      await post({ action: "save-question", question: { ...q, correct: 11 } })
    ).status(),
    400,
  );
  assert.equal(
    (
      await post({ action: "save-question", question: { ...q, version: 0 } })
    ).status(),
    409,
  );
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Acertos", { exact: true }).fill("9");
  await page.getByRole("button", { name: "Salvar registro" }).click();
  await page
    .getByText("Registro salvo. Seu desempenho foi atualizado.")
    .waitFor();
  assert.equal((await state()).questions[0].correct, 9);
  await post({
    action: "save-question",
    question: {
      id: crypto.randomUUID(),
      version: 0,
      subject: "Matemática",
      topic: "Álgebra",
      date: s.today,
      total: 90,
      correct: 45,
    },
  });
  await page.reload();
  await page.getByLabel("54% de acertos em 100 questões").waitFor();
  const other = await browser.newContext();
  await other.request.post(base + "/api/auth", {
    headers: { Origin: base },
    data: {
      action: "register",
      name: "Outro Aluno",
      email: `second${Date.now()}@example.test`,
      password: "Testando-2026!",
    },
  });
  assert.equal(
    (
      await other.request.post(base + "/api/study", {
        headers: { Origin: base },
        data: { action: "delete-question", id: q.id, version: 2 },
      })
    ).status(),
    404,
  );
  await other.close();
  results.push(
    "question creation, edit, weighted analytics, validation, concurrency and ownership",
  );
  await page.goto(base + "/calendario");
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  let rect = await page.locator(".calendar-sheet").boundingBox();
  assert.ok(Math.abs(rect.y + rect.height - 844) < 2);
  await page
    .getByRole("button", { name: "Adicionar tarefa neste dia" })
    .click();
  await page
    .getByLabel("Nome", { exact: true })
    .fill("Tarefa criada pelo calendário");
  await page.getByRole("button", { name: "Criar tarefa", exact: true }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  assert.equal((await state()).items[0].date, s.today);
  results.push("calendar mobile bottom sheet and dated task creation");
  await page.goto(base + "/rotina");
  await page
    .getByRole("button", { name: "Adicionar hábito", exact: true })
    .click();
  await page.getByLabel("Nome", { exact: true }).fill("Leitura diária");
  await page.getByRole("button", { name: "Criar hábito", exact: true }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  results.push("fixed routine habit action");
  const counter = {
    id: crypto.randomUUID(),
    kind: "habit",
    title: "Questões de revisão",
    notes: "",
    frequency: "Todos os dias",
    measure: "count",
    target: 30,
    unit: "questões",
    value: 0,
    date: s.today,
    time: "",
    priority: "Normal",
    done: false,
  };
  assert.equal(
    (await post({ action: "save-item", item: counter })).status(),
    200,
  );
  await page.goto(base);
  await page
    .locator(".home-view-switch")
    .getByRole("button", { name: "Metas", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Aumentar meta de Questões de revisão",
      exact: true,
    })
    .click();
  await page.getByText("31 questões/dia", { exact: true }).waitFor();
  assert.equal(
    (await state()).items.find((i) => i.id === counter.id).target,
    31,
  );
  await page
    .getByRole("button", {
      name: "Diminuir meta de Questões de revisão",
      exact: true,
    })
    .click();
  await page.getByText("30 questões/dia", { exact: true }).waitFor();
  await page
    .locator(".home-view-switch")
    .getByRole("button", { name: "Hoje", exact: true })
    .click();
  assert.ok(await page.locator(".mobile-mission-content").isVisible());
  assert.equal(
    await page.locator(".desktop-mission-content").isVisible(),
    false,
  );
  results.push("mobile mission layout and persistent daily goal controls");
  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => {
      localStorage.setItem("coelho-theme", t);
      document.documentElement.dataset.theme = t;
    }, theme);
    for (const width of [360, 390, 767, 768, 1023, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "/",
        "/rotina",
        "/planos",
        "/calendario",
        "/questoes",
        "/perfil",
      ]) {
        await page.goto(base + route);
        await page.locator(".app-shell").waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `overflow ${theme} ${width} ${route}`,
        );
        assert.equal(
          await page.locator(".header-navigation").isVisible(),
          width < 1024,
        );
        if (width < 1024) {
          assert.equal(await page.locator(".header-navigation a").count(), 5);
          assert.ok(await page.locator(".header-account").isVisible());
        }
        if ([390, 1024, 1440].includes(width)) {
          const report = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          if (report.violations.length)
            results.push({
              theme,
              width,
              route,
              violations: report.violations.map((v) => ({
                id: v.id,
                nodes: v.nodes.map((n) => ({
                  target: n.target,
                  summary: n.failureSummary,
                })),
              })),
            });
        }
        if (
          [390, 1440].includes(width) &&
          ["/", "/questoes", "/calendario"].includes(route)
        )
          await page.screenshot({
            path: `test-results/responsive/${theme}-${width}-${route.slice(1) || "home"}.png`,
            fullPage: true,
          });
        if (route === "/" && [390, 1440].includes(width)) {
          for (const view of ["Desempenho", "Metas"]) {
            await page
              .locator(".home-view-switch")
              .getByRole("button", { name: view, exact: true })
              .click();
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
            );
            const scan = await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze();
            assert.deepEqual(
              scan.violations.map((v) => v.id),
              [],
              `${theme} ${width} ${view}`,
            );
            await page.screenshot({
              path: `test-results/responsive/${theme}-${width}-${view}.png`,
              fullPage: true,
            });
          }
        }
      }
    }
  }
  await page.goto(base + "/questoes");
  await page
    .getByRole("button", { name: "Ver barras por área", exact: true })
    .click();
  assert.ok(await page.locator(".area-bar-list").isVisible());
  await page.getByRole("button", { name: "Ver radar", exact: true }).click();
  await page.locator(".topic-detail summary").first().click();
  assert.ok(await page.locator(".topic-detail[open] p").first().isVisible());
  results.push("radar/bar views and expandable topic names");
  await page
    .getByRole("button", { name: "Excluir", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await page.getByText("Registro excluído.").waitFor();
  assert.equal((await state()).questions.length, 1);
  results.push("question deletion updates persisted records");
  await page.goto(base + "/planos");
  await page
    .getByLabel("Prioridades do dia", { exact: true })
    .fill("Rascunho entre abas");
  await page
    .getByRole("button", { name: "Autorreflexão", exact: true })
    .click();
  await page
    .getByLabel("Observações do dia", { exact: true })
    .fill("Aprendi com a revisão");
  await page
    .getByRole("button", { name: "Planejamento do dia seguinte", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Prioridades do dia", { exact: true }).inputValue(),
    "Rascunho entre abas",
  );
  await page.getByRole("button", { name: "Salvar planejamento" }).click();
  await page.getByText("Planejamento salvo na sua conta.").waitFor();
  results.push("planning tabs preserve both drafts and save together");
  assert.ok(
    results.every((r) => typeof r === "string"),
    "Acessibilidade: consultar violações no relatório",
  );
  assert.deepEqual(errors, []);
  results.push(
    "84 route/theme/viewport combinations without page overflow; 36 accessibility scans without violations",
  );
  writeFileSync(
    "test-results/responsive/report.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (e) {
  await page.screenshot({
    path: "test-results/responsive/failure.png",
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}

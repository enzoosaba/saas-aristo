import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { postgresConfig, postgresSql } from "../src/server/postgres-config.mjs";
const base = process.env.TEST_BASE_URL || "http://localhost:3104";
// Same owner-level access the delivery suite uses to promote an account to
// mentor (SQLite file, or the disposable Postgres when TEST_DATABASE_URL is set).
const pgPool = process.env.TEST_DATABASE_URL
  ? new Pool(
      postgresConfig({
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
      }),
    )
  : null;
const sqliteDb =
  !pgPool && process.env.TEST_DATABASE_PATH
    ? new DatabaseSync(process.env.TEST_DATABASE_PATH)
    : null;
const asOwner = async (sql, args = []) =>
  pgPool
    ? (await pgPool.query(postgresSql(sql), args)).rows
    : sqliteDb.prepare(sql).all(...args);
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
      localStorage.setItem("aristo-theme", t);
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
  // Navigation by role. The bottom bar must show exactly the five fixed
  // destinations for every role; Mentoria / Torre de controle live in the
  // top-bar "more" menu below 1024px and in the sidebar from 1024px up. A
  // label is "cut" when its tab or its own box is narrower than its text
  // (scrollWidth > clientWidth), or when it overlaps its neighbour.
  // The e2e database has no platform_admins (SQLite; isPlatformAdmin() is
  // Postgres-only), so the admin flag is set on the /api/study response the
  // page receives — this exercises the layout, not the authorization, which
  // the Postgres suite covers.
  const fixedLabels = ["Início", "Rotina", "Calendário", "Questões", "Perfil"];
  const roleCases = [
    { name: "student", mentor: false, admin: false, extras: [] },
    { name: "mentor", mentor: true, admin: false, extras: ["Mentoria"] },
    {
      name: "mentor-admin",
      mentor: true,
      admin: true,
      extras: ["Mentoria", "Torre de controle"],
    },
  ];
  const navWidths = [320, 360, 390, 767, 768, 1023, 1024, 1440];
  let navChecks = 0;
  for (const role of roleCases) {
    const roleCtx = await browser.newContext({ reducedMotion: "reduce" });
    const roleEmail = `nav-${role.name}-${Date.now()}@example.test`;
    assert.equal(
      (
        await roleCtx.request.post(base + "/api/auth", {
          headers: { Origin: base },
          data: {
            action: "register",
            name: `Aluno ${role.name}`,
            email: roleEmail,
            password: "Testando-2026!",
          },
        })
      ).status(),
      201,
    );
    if (role.mentor)
      await asOwner("UPDATE users SET role='mentor' WHERE email=?", [
        roleEmail,
      ]);
    const rolePage = await roleCtx.newPage();
    rolePage.on("pageerror", (e) => errors.push(`${role.name}: ${e.message}`));
    if (role.admin)
      await rolePage.route("**/api/study", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const res = await route.fetch();
        const json = await res.json();
        json.platformAdmin = true;
        await route.fulfill({ response: res, json });
      });
    const routes = [
      "/",
      "/rotina",
      "/perfil",
      ...(role.mentor ? ["/mentoria"] : []),
    ];
    for (const width of navWidths) {
      await rolePage.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        const at = `${role.name} ${width} ${route}`;
        await rolePage.goto(base + route);
        await rolePage.locator(".app-shell").waitFor();
        if (role.extras.length)
          await rolePage
            .locator(width < 1024 ? ".more-menu-trigger" : ".desktop-sidebar")
            .waitFor();
        const nav = await rolePage.evaluate(() => {
          const vis = (el) => el.getClientRects().length > 0;
          const bar = document.querySelector(".header-navigation");
          const br = bar.getBoundingClientRect();
          const trigger = document.querySelector(".more-menu-trigger");
          const tr =
            trigger && vis(trigger) ? trigger.getBoundingClientRect() : null;
          const progress = document.querySelector(".header-progress");
          const pr =
            progress && vis(progress) ? progress.getBoundingClientRect() : null;
          return {
            vw: innerWidth,
            barVisible: vis(bar),
            bar: { left: br.left, right: br.right },
            tabs: [...bar.querySelectorAll("a")].filter(vis).map((a) => {
              const span = a.querySelector("span");
              const r = span.getBoundingClientRect();
              return {
                label: span.textContent,
                tabFits: a.scrollWidth <= a.clientWidth,
                labelFits: span.scrollWidth <= span.clientWidth,
                left: r.left,
                right: r.right,
              };
            }),
            trigger: tr && {
              left: tr.left,
              right: tr.right,
              w: tr.width,
              h: tr.height,
            },
            progressRight: pr ? pr.right : null,
            sidebarRoleLinks: [
              ...document.querySelectorAll(
                '.desktop-sidebar a[href="/mentoria"], .desktop-sidebar a[href="/admin"]',
              ),
            ]
              .filter(vis)
              .map((a) => a.getAttribute("href")),
          };
        });
        if (width >= 1024) {
          assert.equal(nav.barVisible, false, `bottom bar hidden ${at}`);
          assert.equal(nav.trigger, null, `no more-menu on desktop ${at}`);
          const expected = [
            ...(role.mentor ? ["/mentoria"] : []),
            ...(role.admin ? ["/admin"] : []),
          ];
          assert.deepEqual(
            [...nav.sidebarRoleLinks].sort(),
            expected.sort(),
            `sidebar role links ${at}`,
          );
        } else {
          assert.ok(nav.barVisible, `bottom bar visible ${at}`);
          assert.deepEqual(
            nav.tabs.map((t) => t.label),
            fixedLabels,
            `bottom bar shows exactly the five fixed tabs ${at}`,
          );
          assert.ok(
            nav.bar.left >= 0 && nav.bar.right <= nav.vw,
            `bottom bar inside viewport ${at}`,
          );
          for (const [i, tab] of nav.tabs.entries()) {
            assert.ok(
              tab.tabFits,
              `label cut (tab scrollWidth>clientWidth): ${tab.label} ${at}`,
            );
            assert.ok(
              tab.labelFits,
              `label cut (label scrollWidth>clientWidth): ${tab.label} ${at}`,
            );
            if (i)
              assert.ok(
                tab.left >= nav.tabs[i - 1].right,
                `labels overlap: ${nav.tabs[i - 1].label} / ${tab.label} ${at}`,
              );
          }
          if (role.extras.length) {
            assert.ok(nav.trigger, `more-menu trigger present ${at}`);
            assert.ok(
              nav.trigger.w >= 44 && nav.trigger.h >= 44,
              `more-menu trigger touch size ${at}`,
            );
            assert.ok(
              nav.trigger.right <= nav.vw,
              `trigger inside viewport ${at}`,
            );
            if (nav.progressRight !== null)
              assert.ok(
                nav.progressRight <= nav.trigger.left,
                `streak/XP does not run under the more-menu trigger ${at}`,
              );
          } else {
            assert.equal(
              nav.trigger,
              null,
              `plain student has no more-menu ${at}`,
            );
          }
        }
        navChecks++;
      }
      // Menu behaviour: once per role and width, on the home page.
      if (width < 1024 && role.extras.length) {
        await rolePage.goto(base + "/");
        await rolePage.locator(".more-menu-trigger").waitFor();
        const at = `${role.name} ${width}`;
        const trigger = rolePage.locator(".more-menu-trigger");
        assert.equal(await trigger.getAttribute("aria-expanded"), "false");
        assert.equal(
          await rolePage.locator(".more-menu-panel").isVisible(),
          false,
        );
        await trigger.click();
        assert.equal(await trigger.getAttribute("aria-expanded"), "true");
        const menu = await rolePage.evaluate(() => {
          const panel = document.querySelector(".more-menu-panel");
          const pr = panel.getBoundingClientRect();
          return {
            left: pr.left,
            right: pr.right,
            vw: innerWidth,
            items: [...panel.querySelectorAll("a")].map((a) => ({
              label: a.textContent,
              fits: a.scrollWidth <= a.clientWidth,
              height: a.getBoundingClientRect().height,
            })),
          };
        });
        if (width === 390) {
          const scan = await new AxeBuilder({ page: rolePage })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          assert.deepEqual(
            scan.violations.map((v) => v.id),
            [],
            `accessibility with the menu open ${at}`,
          );
        }
        assert.deepEqual(
          menu.items.map((i) => i.label),
          role.extras,
          `menu items ${at}`,
        );
        assert.ok(
          menu.left >= 0 && menu.right <= menu.vw,
          `menu inside viewport ${at}`,
        );
        for (const item of menu.items) {
          assert.ok(item.fits, `menu label cut: ${item.label} ${at}`);
          assert.ok(
            item.height >= 44,
            `menu item touch size: ${item.label} ${at}`,
          );
        }
        await rolePage.keyboard.press("Escape");
        assert.equal(
          await rolePage.locator(".more-menu-panel").isVisible(),
          false,
        );
        assert.equal(
          await rolePage.evaluate(
            () =>
              document.activeElement ===
              document.querySelector(".more-menu-trigger"),
          ),
          true,
          `focus returns to the trigger on Escape ${at}`,
        );
        await trigger.click();
        await rolePage.mouse.click(4, 600);
        assert.equal(
          await rolePage.locator(".more-menu-panel").isVisible(),
          false,
          `outside click closes ${at}`,
        );
        if (width === 390) {
          await trigger.click();
          await rolePage
            .getByRole("link", { name: "Mentoria", exact: true })
            .click();
          await rolePage.waitForURL("**/mentoria");
          assert.equal(
            await rolePage.locator(".more-menu-panel").isVisible(),
            false,
          );
          assert.equal(
            await rolePage
              .locator(".more-menu-trigger")
              .getAttribute("data-current"),
            "true",
            "trigger shows the current section is a menu one",
          );
        }
        navChecks++;
      }
    }
    await roleCtx.close();
  }
  results.push(
    `bottom navigation by role (student, mentor, mentor+admin) at ${navWidths.join("/")}px: ${navChecks} checks — exactly the five fixed tabs, no label cut (scrollWidth<=clientWidth) or overlap, Mentoria/Torre de controle in the top menu below 1024px and in the sidebar from 1024px`,
  );
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
  await pgPool?.end();
  sqliteDb?.close();
}

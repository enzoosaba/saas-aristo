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
  // /questoes is either the real question bank or, while
  // QUESTION_BANK_ENABLED is false (src/lib/features.ts), an "Em breve" notice.
  // The suite adapts to whichever is live: the data behaviour (API validation,
  // versions, ownership, weighted analytics) is always exercised; the form and
  // history UI steps run only when the screen is open, and the notice is
  // asserted when it is not.
  await page.goto(base + "/questoes");
  await page.locator("h1").first().waitFor();
  const comingSoon =
    (await page.locator('[data-module-state="coming-soon"]').count()) > 0;
  const mathTopic = "Geometria plana e interpretação de situações-problema";
  if (comingSoon) {
    assert.equal(await page.locator("h1").innerText(), "Banco de questões");
    await page.getByRole("heading", { name: "Em breve" }).waitFor();
    assert.equal(
      await page.locator(".question-form").count(),
      0,
      "the question form must not be reachable while the module is Em breve",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Voltar ao início" })
        .getAttribute("href"),
      "/",
    );
    // The navigation entry stays, and is the current page.
    assert.equal(
      await page.locator('.header-navigation a[href="/questoes"]').innerText(),
      "Questões",
    );
    assert.equal(
      await page
        .locator('.header-navigation a[href="/questoes"]')
        .getAttribute("aria-current"),
      "page",
    );
    assert.equal(
      (
        await post({
          action: "save-question",
          question: {
            id: crypto.randomUUID(),
            version: 0,
            subject: "Matemática",
            topic: mathTopic,
            date: s.today,
            total: 10,
            correct: 8,
          },
        })
      ).status(),
      200,
    );
  } else {
    await page.getByLabel("Matéria / área").selectOption("Matemática");
    await page.getByLabel("Tópico", { exact: true }).fill(mathTopic);
    await page.getByLabel("Questões respondidas").fill("10");
    await page.getByLabel("Acertos", { exact: true }).fill("8");
    await page.getByRole("button", { name: "Salvar registro" }).click();
    await page
      .getByText("Registro salvo. Seu desempenho foi atualizado.")
      .waitFor();
  }
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
  if (comingSoon) {
    assert.equal(
      (
        await post({ action: "save-question", question: { ...q, correct: 9 } })
      ).status(),
      200,
    );
  } else {
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.getByLabel("Acertos", { exact: true }).fill("9");
    await page.getByRole("button", { name: "Salvar registro" }).click();
    await page
      .getByText("Registro salvo. Seu desempenho foi atualizado.")
      .waitFor();
  }
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
  if (!comingSoon) {
    await page.reload();
    await page.getByLabel("54% de acertos em 100 questões").waitFor();
  }
  // The same analytics are on the home page (Desempenho), which stays live
  // whether or not /questoes is open.
  await page.goto(base + "/");
  await page
    .locator(".home-view-switch")
    .getByRole("button", { name: "Desempenho", exact: true })
    .click();
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
    `question flow (${comingSoon ? "screen shows Em breve, data through the API" : "through the screen"}): creation, edit, weighted analytics, validation, concurrency and ownership`,
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
      "/questoes",
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
          const brand = document.querySelector(".header-brand");
          const brr = brand && vis(brand) ? brand.getBoundingClientRect() : null;
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
            brand: brr && { w: brr.width, h: brr.height },
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
          assert.ok(
            nav.brand && nav.brand.w >= 44 && nav.brand.h >= 44,
            `logo link is at least a 44px touch target ${at}`,
          );
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
  // The analytics component (radar/bars, expandable topics) is on the home
  // page too, so it is exercised whether or not /questoes is open.
  await page.goto(base + "/");
  await page
    .locator(".home-view-switch")
    .getByRole("button", { name: "Desempenho", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ver barras por área", exact: true })
    .click();
  assert.ok(await page.locator(".area-bar-list").isVisible());
  await page.getByRole("button", { name: "Ver radar", exact: true }).click();
  await page.locator(".topic-detail summary").first().click();
  assert.ok(await page.locator(".topic-detail[open] p").first().isVisible());
  results.push("radar/bar views and expandable topic names (home > Desempenho)");
  if (comingSoon) {
    const target = (await state()).questions[0];
    assert.equal(
      (
        await post({
          action: "delete-question",
          id: target.id,
          version: target.version,
        })
      ).status(),
      200,
    );
  } else {
    await page.goto(base + "/questoes");
    await page
      .getByRole("button", { name: "Excluir", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Confirmar exclusão" }).click();
    await page.getByText("Registro excluído.").waitFor();
  }
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
  // Progress bars must be drawn the same on a phone and on a desktop. The
  // native <progress> ones must not be left to the browser's own renderer
  // (appearance: none), and every bar's shape (radius, height) must match
  // between 390px and 1440px.
  {
    const barStyle = (locator) =>
      locator.first().evaluate((el) => {
        const c = getComputedStyle(el);
        return {
          tag: el.tagName,
          appearance: c.appearance,
          radius: c.borderTopLeftRadius,
          height: c.height,
        };
      });
    const seen = {};
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      seen[width] = {};
      await page.goto(base + "/");
      await page.locator(".streak-highlight progress").waitFor();
      seen[width].home = await barStyle(
        page.locator(".streak-highlight progress"),
      );
      await page.goto(base + "/rotina");
      await page.getByRole("button", { name: "Controle", exact: true }).click();
      seen[width].weekly = await barStyle(page.locator(".weekly-progress"));
      await page
        .getByRole("button", { name: "Habit tracker", exact: true })
        .click();
      seen[width].habit = await barStyle(page.locator("[role=progressbar]"));
      if (width === 390)
        assert.ok(
          (await page
            .locator(".personal-item-title span")
            .first()
            .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 11,
          "routine card tags (HÁBITO/TAREFA) are at least 11px on phones",
        );
      await page.goto(base + "/");
      await page
        .locator(".home-view-switch")
        .getByRole("button", { name: "Desempenho", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Ver barras por área", exact: true })
        .click();
      seen[width].area = await barStyle(page.locator(".area-bar-list progress"));
      await page.goto(base + "/perfil");
      seen[width].level = await barStyle(page.locator("[role=progressbar]"));
    }
    for (const name of Object.keys(seen[390])) {
      assert.deepEqual(
        seen[390][name],
        seen[1440][name],
        `progress bar "${name}" is drawn differently at 390px and 1440px`,
      );
      if (seen[390][name].tag === "PROGRESS") {
        assert.equal(
          seen[390][name].appearance,
          "none",
          `progress bar "${name}" is left to the native renderer`,
        );
        assert.notEqual(seen[390][name].radius, "0px", `progress "${name}"`);
      }
    }
    results.push(
      "progress bars (home streak, rotina weekly, rotina habit, questões by area, perfil level) drawn identically at 390px and 1440px; native <progress> ones do not depend on the browser renderer",
    );
  }
  // Branding: the product name is "Plataforma Coelho" everywhere it is visible,
  // and the old "Mentoria Coelho" does not appear on any main screen. The
  // "MENTORIA" heading of the mentor section in the sidebar is a feature name,
  // not the brand, and stays.
  {
    const oldName = /mentoria coelho|coelho mentoria/i;
    const routes = ["/", "/rotina", "/planos", "/calendario", "/questoes", "/perfil"];
    for (const width of [390, 1023, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(base + route);
        await page.locator(".app-shell").waitFor();
        const text = await page.evaluate(() => document.body.innerText);
        assert.doesNotMatch(text, oldName, `old brand name visible at ${width} ${route}`);
        assert.equal(await page.title(), "Plataforma Coelho");
        const labels = await page.evaluate(() =>
          [...document.querySelectorAll("[aria-label],[alt]")].map(
            (el) => el.getAttribute("aria-label") || el.getAttribute("alt") || "",
          ),
        );
        assert.equal(
          labels.some((l) => oldName.test(l)),
          false,
          `old brand name in an aria-label/alt at ${width} ${route}`,
        );
      }
    }
    // Desktop: the workspace switcher and the breadcrumb carry the new name.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + "/");
    await page.locator(".desktop-workspace summary strong").waitFor();
    assert.equal(
      await page.locator(".desktop-workspace summary strong").innerText(),
      "Plataforma Coelho",
    );
    // The breadcrumb's first crumb is hidden by CSS at this width, but the
    // markup still carries the name.
    assert.match(
      await page.locator(".desktop-breadcrumb").textContent(),
      /Plataforma Coelho/,
    );
    // Top-bar wordmark: today its text is hidden at every width (icon only
    // below 1024px, and the whole brand block gives way to the sidebar from
    // 1024px), so what can be asserted is the markup, plus that it would not
    // overflow or touch the streak/XP if it were shown.
    for (const width of [768, 1023]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + "/");
      await page.locator(".header-brand").waitFor();
      const wordmark = await page.evaluate(() => {
        const brand = document.querySelector(".header-brand");
        const small = brand.querySelector("small");
        const progress = document.querySelector(".header-progress");
        const shown = small.getClientRects().length > 0;
        const b = brand.getBoundingClientRect();
        const s = small.getBoundingClientRect();
        const p = progress && progress.getClientRects().length ? progress.getBoundingClientRect() : null;
        return {
          small: small.textContent,
          shown,
          fits: !shown || brand.scrollWidth <= brand.clientWidth + 1,
          smallInsideBrand: !shown || s.right <= b.right + 1,
          clearOfProgress: !shown || !p || s.right <= p.left,
        };
      });
      assert.equal(wordmark.small, "PLATAFORMA");
      assert.ok(wordmark.fits, `wordmark overflows its box at ${width}`);
      assert.ok(wordmark.smallInsideBrand, `PLATAFORMA sticks out of the brand box at ${width}`);
      assert.ok(wordmark.clearOfProgress, `wordmark runs into streak/XP at ${width}`);
    }
    // Login screen (no session): PLATAFORMA COELHO and the logo's alt text.
    const anon = await browser.newContext({ reducedMotion: "reduce" });
    const anonPage = await anon.newPage();
    for (const width of [390, 1440]) {
      await anonPage.setViewportSize({ width, height: 900 });
      await anonPage.goto(base + "/");
      await anonPage.locator(".auth-screen").waitFor();
      assert.match(await anonPage.locator(".auth-top").innerText(), /PLATAFORMA COELHO/);
      assert.equal(
        await anonPage.locator(".auth-card img").getAttribute("alt"),
        "Plataforma Coelho",
      );
      assert.doesNotMatch(await anonPage.evaluate(() => document.body.innerText), oldName);
    }
    await anon.close();
    results.push(
      "brand name: Plataforma Coelho in title, login, sidebar, breadcrumb and top-bar wordmark markup (PLATAFORMA; its text is hidden at every width today); old name absent from six routes at 390/1023/1440px",
    );
  }
  // Logo: the file is solid brand orange (#ff5d00) with a transparent
  // background, no CSS filter is stacked on it, it actually loads in the top
  // bar / login / sidebar, and the old two-tone file is gone.
  {
    assert.equal(
      (await page.request.get(base + "/brand/coelho.png")).status(),
      404,
      "the old two-tone logo file must be gone",
    );
    const mark = await page.request.get(base + "/brand/coelho-mark.png");
    assert.equal(mark.status(), 200);
    assert.match(mark.headers()["content-type"], /image\/png/);
    await page.goto(base + "/");
    const pixels = await page.evaluate(async () => {
      const image = new Image();
      image.src = "/brand/coelho-mark.png";
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let opaque = 0, notBrand = 0, transparent = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 255) {
          opaque++;
          if (data[i] !== 255 || data[i + 1] !== 93 || data[i + 2] !== 0) notBrand++;
        } else if (data[i + 3] === 0) transparent++;
      }
      return {
        w: canvas.width,
        h: canvas.height,
        opaque,
        notBrand,
        transparentShare: transparent / (data.length / 4),
        corner: [...data.slice(0, 4)],
      };
    });
    assert.deepEqual([pixels.w, pixels.h], [1254, 1254]);
    assert.ok(pixels.opaque > 100000, "the logo body must be opaque");
    assert.equal(pixels.notBrand, 0, "every opaque pixel must be exactly #ff5d00");
    assert.equal(pixels.corner[3], 0, "the background must be transparent");
    assert.ok(pixels.transparentShare > 0.6);

    const logoState = async (p, selector) =>
      p.locator(selector).first().evaluate((img) => ({
        loaded: img.complete && img.naturalWidth > 0,
        filter: getComputedStyle(img).filter,
      }));
    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => {
        localStorage.setItem("aristo-theme", t);
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(base + "/");
      await page.locator(".brand-rabbit").waitFor();
      const top = await logoState(page, ".brand-rabbit");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base + "/");
      await page.locator(".desktop-workspace summary img").waitFor();
      const side = await logoState(page, ".desktop-workspace summary img");
      for (const [where, state] of [["top bar", top], ["sidebar", side]]) {
        assert.ok(state.loaded, `${where} logo did not load (${theme})`);
        assert.equal(state.filter, "none", `${where} logo has a CSS filter (${theme})`);
      }
    }
    const anonCtx = await browser.newContext({ reducedMotion: "reduce" });
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(base + "/");
    await anonPage.locator(".auth-card img").waitFor();
    await anonPage.waitForFunction(() => {
      const img = document.querySelector(".auth-card img");
      return img.complete && img.naturalWidth > 0;
    });
    assert.equal((await logoState(anonPage, ".auth-card img")).filter, "none");
    await anonCtx.close();
    results.push(
      "logo: /brand/coelho-mark.png is 1254x1254, transparent background, every opaque pixel exactly #ff5d00; loads in top bar, sidebar and login with no CSS filter in both themes; the old coelho.png is gone",
    );
  }
  // Favicon, app icons and web manifest: what the browser tab, "Add to Home
  // Screen" and "Install app" use. Everything is fetched WITHOUT a session (an
  // installing browser has none), declared sizes must match the real image
  // dimensions, and no service worker may exist (push is a later decision).
  {
    const anonCtx = await browser.newContext({ reducedMotion: "reduce" });
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(base + "/");
    const links = await anonPage.evaluate(() =>
      [...document.querySelectorAll("link[rel]")].map((l) => ({
        rel: l.getAttribute("rel"),
        href: l.getAttribute("href"),
        sizes: l.getAttribute("sizes"),
        type: l.getAttribute("type"),
      })),
    );
    const fetchOk = async (href) => {
      const response = await anonCtx.request.get(new URL(href, base).href);
      assert.equal(response.status(), 200, `GET ${href}`);
      return { body: await response.body(), type: response.headers()["content-type"] };
    };
    const pngSize = (buf) => {
      assert.equal(buf.subarray(1, 4).toString(), "PNG", "not a PNG");
      return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
    };

    // <head>: manifest, favicon.ico, PNG icon and apple-touch-icon.
    const manifestLink = links.find((l) => l.rel === "manifest");
    assert.ok(manifestLink, "missing <link rel=manifest>");
    const iconLinks = links.filter((l) => l.rel === "icon");
    const icoLink = iconLinks.find((l) => l.type === "image/x-icon");
    const pngLink = iconLinks.find((l) => l.type === "image/png");
    const appleLink = links.find((l) => l.rel === "apple-touch-icon");
    assert.ok(icoLink && pngLink && appleLink, "missing favicon/icon/apple-touch-icon links");

    // favicon.ico: ICO container with 16, 32 and 48px images.
    const ico = await fetchOk(icoLink.href);
    assert.match(ico.type, /icon/);
    assert.equal(ico.body.readUInt16LE(0), 0);
    assert.equal(ico.body.readUInt16LE(2), 1, "not an ICO (type 1)");
    const entries = ico.body.readUInt16LE(4);
    const icoSizes = [];
    for (let i = 0; i < entries; i++) {
      const e = 6 + i * 16;
      const offset = ico.body.readUInt32LE(e + 12);
      const embedded = pngSize(ico.body.subarray(offset));
      assert.equal(embedded, `${ico.body[e]}x${ico.body[e + 1]}`, "ICO entry size vs embedded image");
      icoSizes.push(ico.body[e]);
    }
    assert.deepEqual(icoSizes, [16, 32, 48]);

    // Tab icon and iOS icon: real dimensions equal the declared ones.
    for (const link of [pngLink, appleLink]) {
      const image = await fetchOk(link.href);
      assert.match(image.type, /image\/png/);
      assert.equal(pngSize(image.body), link.sizes, `${link.href} declared ${link.sizes}`);
    }
    assert.equal(appleLink.sizes, "180x180");

    // Manifest.
    const manifestResponse = await fetchOk(manifestLink.href);
    assert.match(manifestResponse.type, /json/);
    const manifest = JSON.parse(manifestResponse.body.toString());
    assert.equal(manifest.name, "Plataforma Coelho");
    assert.ok(manifest.short_name && manifest.short_name.length <= 12);
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/");
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    const purposes = new Set();
    for (const icon of manifest.icons) {
      const image = await fetchOk(icon.src);
      assert.match(image.type, /image\/png/);
      assert.equal(pngSize(image.body), icon.sizes, `${icon.src} declared ${icon.sizes}`);
      purposes.add(`${icon.sizes}:${icon.purpose}`);
    }
    for (const required of ["192x192:any", "512x512:any", "512x512:maskable"])
      assert.ok(purposes.has(required), `manifest lacks ${required}`);

    // No service worker: this is install metadata only.
    assert.equal(
      await anonPage.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
      0,
      "no service worker may be registered",
    );
    await anonCtx.close();
    results.push(
      "favicon and app icons: <head> links, favicon.ico with 16/32/48px, tab icon 512, apple-touch-icon 180, web manifest (Plataforma Coelho, standalone, 192/512 any + 512 maskable) — all fetched without a session with real sizes matching the declared ones; no service worker",
    );
  }
  // "Mais" menu: the icon of the SELECTED item (orange background) must have
  // real contrast against that background — every icon otherwise gets the
  // orange-gradient stroke, the same colour as the selected item — and this
  // must follow the selection, not be tied to one item.
  {
    const ctxMenu = await browser.newContext({ reducedMotion: "reduce" });
    const emailMenu = `menu-contrast-${Date.now()}@example.test`;
    assert.equal(
      (
        await ctxMenu.request.post(base + "/api/auth", {
          headers: { Origin: base },
          data: { action: "register", name: "Menu Contraste", email: emailMenu, password: "Testando-2026!" },
        })
      ).status(),
      201,
    );
    await asOwner("UPDATE users SET role='mentor' WHERE email=?", [emailMenu]);
    const menuPage = await ctxMenu.newPage();
    await menuPage.route("**/api/study", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const json = await res.json();
      json.platformAdmin = true;
      await route.fulfill({ response: res, json });
    });
    await menuPage.route("**/api/admin", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { members: [] } })
        : route.fulfill({ json: { ok: true } }),
    );
    const readMenu = () =>
      menuPage.evaluate(() => {
        const lum = (rgb) => {
          const [r, g, b] = rgb.map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a, b) => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const stops = (
          getComputedStyle(document.documentElement).getPropertyValue("--brand-gradient").match(/#[0-9a-f]{6}/gi) || []
        ).map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
        return [...document.querySelectorAll(".more-menu-item")].map((a) => {
          const svg = a.querySelector("svg");
          const stroke = getComputedStyle(svg).stroke;
          const m = stroke.match(/rgba?\((\d+), (\d+), (\d+)/);
          const rgb = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
          return {
            label: a.textContent.trim(),
            current: a.getAttribute("aria-current") === "page",
            stroke,
            bg: getComputedStyle(a).backgroundImage.includes("gradient"),
            minContrast: rgb && stops.length ? Math.min(...stops.map((s) => ratio(rgb, s))) : null,
          };
        });
      });
    const openMenu = async () => {
      await menuPage.locator(".more-menu-trigger").click();
      await menuPage.locator(".more-menu-panel").waitFor({ state: "visible" });
    };
    let checks = 0;
    for (const theme of ["dark", "light"]) {
      for (const width of [390, 1023]) {
        await menuPage.setViewportSize({ width, height: 800 });
        await menuPage.goto(base + "/mentoria");
        await menuPage.locator(".more-menu-trigger").waitFor();
        await menuPage.evaluate((t) => {
          localStorage.setItem("aristo-theme", t);
          document.documentElement.dataset.theme = t;
        }, theme);
        const at = `${theme} ${width}`;
        await openMenu();
        let items = await readMenu();
        // 1. Mentoria is current: icon has contrast; Torre de controle keeps the normal colour.
        const m1 = items.find((i) => i.label === "Mentoria");
        const t1 = items.find((i) => i.label === "Torre de controle");
        assert.ok(m1.current && !t1.current, `Mentoria must be current (${at})`);
        assert.ok(m1.bg, `current item keeps the orange background (${at})`);
        assert.ok(m1.minContrast >= 4.5, `current icon contrast ${m1.minContrast?.toFixed(2)} < 4.5 vs the orange background (${at}): stroke ${m1.stroke}`);
        assert.notEqual(t1.stroke, m1.stroke, `non-current icon must keep its normal colour (${at})`);
        assert.ok(!t1.bg, `non-current item has no orange background (${at})`);
        // hover on the current item must not turn it dark-on-dark
        await menuPage.locator(".more-menu-item", { hasText: "Mentoria" }).hover();
        const hovered = (await readMenu()).find((i) => i.label === "Mentoria");
        assert.ok(hovered.bg && hovered.minContrast >= 4.5, `current item stays readable on hover (${at})`);
        // 2. The selection moves: Torre de controle becomes current, Mentoria reverts.
        const normalStroke = t1.stroke;
        await menuPage.locator(".more-menu-item", { hasText: "Torre de controle" }).click();
        await menuPage.waitForURL("**/admin");
        await menuPage.locator(".more-menu-trigger").waitFor();
        await openMenu();
        items = await readMenu();
        const m2 = items.find((i) => i.label === "Mentoria");
        const t2 = items.find((i) => i.label === "Torre de controle");
        assert.ok(t2.current && !m2.current, `Torre de controle must be current (${at})`);
        assert.ok(t2.minContrast >= 4.5, `Torre de controle icon contrast ${t2.minContrast?.toFixed(2)} (${at}): stroke ${t2.stroke}`);
        assert.equal(m2.stroke, normalStroke, `Mentoria reverts to the normal icon colour (${at})`);
        assert.ok(!m2.bg, `Mentoria loses the orange background (${at})`);
        // back to Mentoria, so the next round starts from a known page
        await menuPage.locator(".more-menu-item", { hasText: "Mentoria" }).click();
        await menuPage.waitForURL("**/mentoria");
        checks += 2;
      }
    }
    await ctxMenu.close();
    results.push(
      `"Mais" menu: the selected item's icon has >= 4.5:1 contrast against the orange background for both items, follows the selection (previous item reverts to the normal icon colour), stays readable on hover; dark and light, 390/1023px (${checks} selection rounds)`,
    );
  }
  // Primary call-to-action buttons: one size and typography everywhere
  // (44-48px tall, 12px corners, 15px/600, 20px side padding), and the "add"
  // actions are content-sized on phones instead of stretching across the screen.
  {
    const measure = (p) =>
      p.evaluate(() =>
        [...document.querySelectorAll(".primary-button")]
          .filter((el) => el.getClientRects().length)
          .map((el) => {
            const c = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
              text: el.textContent.trim(),
              w: Math.round(r.width),
              h: r.height,
              fs: c.fontSize,
              fw: c.fontWeight,
              br: c.borderTopLeftRadius,
              pl: c.paddingLeft,
              pr: c.paddingRight,
            };
          }),
      );
    let buttonChecks = 0;
    const expectButtons = async (p, at, expected) => {
      const list = await measure(p);
      for (const label of expected)
        assert.ok(list.some((b) => b.text.includes(label)), `primary button "${label}" not found (${at}); saw ${JSON.stringify(list.map((b) => b.text))}`);
      for (const b of list) {
        assert.ok(b.h >= 44 && b.h <= 48, `"${b.text}" is ${b.h}px tall (${at})`);
        assert.equal(b.fs, "15px", `"${b.text}" font-size (${at})`);
        assert.equal(b.fw, "600", `"${b.text}" font-weight (${at})`);
        assert.equal(b.br, "12px", `"${b.text}" corner radius (${at})`);
        assert.equal(b.pl, "20px", `"${b.text}" left padding (${at})`);
        assert.equal(b.pr, "20px", `"${b.text}" right padding (${at})`);
        buttonChecks++;
      }
      return list;
    };
    const go = async (p, route) => {
      await p.goto(base + route);
      await p.locator(".app-shell").waitFor();
      await p.waitForTimeout(150);
    };
    // student pages, phone and desktop
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await go(page, "/rotina");
      const rotina = await expectButtons(page, `rotina ${width}`, ["Adicionar hábito"]);
      await go(page, "/planos");
      const planos = await expectButtons(page, `planos ${width}`, ["Nova sessão", "Salvar planejamento"]);
      await go(page, "/perfil");
      await expectButtons(page, `perfil ${width}`, ["Salvar perfil", "Alterar senha"]);
      await go(page, "/questoes");
      await expectButtons(page, `questoes ${width}`, [comingSoon ? "Voltar ao início" : "Salvar registro"]);
      // the quick-add habit form (dialog)
      await go(page, "/rotina");
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent("aristo:add", { detail: { kind: "habit", date: new Date().toISOString().slice(0, 10) } })),
      );
      await page.getByRole("button", { name: "Criar hábito", exact: true }).waitFor();
      await expectButtons(page, `quick-add ${width}`, ["Criar hábito"]);
      await page.keyboard.press("Escape");
      if (width === 390) {
        const add = rotina.find((b) => b.text.includes("Adicionar hábito"));
        const session = planos.find((b) => b.text.includes("Nova sessão"));
        assert.ok(add.w <= 240, `"Adicionar hábito" stretches across the phone (${add.w}px wide)`);
        assert.ok(session.w <= 240, `"Nova sessão" stretches across the phone (${session.w}px wide)`);
      }
    }
    // login screen
    const anonBtn = await browser.newContext({ reducedMotion: "reduce" });
    const anonBtnPage = await anonBtn.newPage();
    for (const width of [390, 1440]) {
      await anonBtnPage.setViewportSize({ width, height: 900 });
      await anonBtnPage.goto(base + "/");
      // ".auth-screen" is also the loading state; wait for the form itself.
      await anonBtnPage.locator(".auth-card .primary-button").waitFor();
      await expectButtons(anonBtnPage, `login ${width}`, ["Entrar"]);
    }
    await anonBtn.close();
    // mentor / admin pages
    const mentorBtn = await browser.newContext({ reducedMotion: "reduce" });
    const mentorEmail = `btn-mentor-${Date.now()}@example.test`;
    assert.equal(
      (await mentorBtn.request.post(base + "/api/auth", { headers: { Origin: base }, data: { action: "register", name: "Botoes Mentor", email: mentorEmail, password: "Testando-2026!" } })).status(),
      201,
    );
    await asOwner("UPDATE users SET role='mentor' WHERE email=?", [mentorEmail]);
    const mentorPage = await mentorBtn.newPage();
    await mentorPage.route("**/api/study", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const json = await res.json();
      json.platformAdmin = true;
      await route.fulfill({ response: res, json });
    });
    await mentorPage.route("**/api/admin", (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: { members: [] } }) : route.fulfill({ json: { ok: true } }),
    );
    for (const width of [390, 1440]) {
      await mentorPage.setViewportSize({ width, height: 900 });
      await go(mentorPage, "/mentoria");
      await expectButtons(mentorPage, `mentoria ${width}`, ["Adicionar aluno"]);
      await go(mentorPage, "/admin");
      await expectButtons(mentorPage, `admin ${width}`, ["Criar conta"]);
    }
    await mentorBtn.close();
    results.push(
      `primary buttons: ${buttonChecks} button measurements across login, rotina, planos, perfil, questões, quick-add, mentoria and admin at 390/1440px — all 44-48px tall, 12px corners, 15px/600, 20px padding; "Adicionar hábito" and "Nova sessão" are content-sized (<= 240px) on phones`,
    );
  }
  // iPhone: (a) no text field may be under 16px on a phone — iOS Safari zooms
  // into such a field on focus and the zoom survives navigation inside this
  // single-page app, leaving the next screen magnified and cut off at the top;
  // (b) the app's own scrolling behaves in both ways of arriving at the home
  // page (switching route, and loading/reloading it directly).
  {
    const iphone = {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    };
    const fieldSizes = (p) =>
      p.evaluate(() =>
        [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), select, textarea')]
          .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
          .map((el) => ({
            what: `${el.tagName.toLowerCase()}[${el.getAttribute("type") || ""}] ${el.getAttribute("name") || el.getAttribute("aria-label") || el.placeholder || ""}`.trim(),
            fs: parseFloat(getComputedStyle(el).fontSize),
          })),
      );
    let fieldChecks = 0;
    const expectFields = async (p, at, min) => {
      const list = await fieldSizes(p);
      assert.ok(list.length >= min, `expected at least ${min} text field(s) (${at}), found ${list.length}`);
      for (const f of list) assert.ok(f.fs >= 16, `${f.what} is ${f.fs}px (${at}): iOS zooms into fields under 16px`);
      fieldChecks += list.length;
    };
    const goShell = async (p, route) => {
      await p.goto(base + route);
      await p.locator(".app-shell").waitFor();
      await p.waitForTimeout(200);
    };

    // student: every screen and dialog that has a text field
    const phoneCtx = await browser.newContext(iphone);
    const phoneEmail = `iphone-${Date.now()}@example.test`;
    assert.equal(
      (await phoneCtx.request.post(base + "/api/auth", { headers: { Origin: base }, data: { action: "register", name: "Aluno iPhone", email: phoneEmail, password: "Testando-2026!" } })).status(),
      201,
    );
    const phonePost = (data) => phoneCtx.request.post(base + "/api/study", { headers: { Origin: base }, data });
    const phoneToday = (await (await phoneCtx.request.get(base + "/api/study")).json()).today;
    const phoneItems = [];
    for (let n = 0; n < 8; n++) {
      const id = crypto.randomUUID();
      phoneItems.push(id);
      await phonePost({ action: "save-item", item: { id, kind: "habit", title: `Atividade ${n + 1}`, notes: "", frequency: "Todos os dias", measure: "check", target: 1, unit: "", value: 0, date: phoneToday, time: "", priority: "Normal", done: false } });
    }
    for (const id of phoneItems.slice(0, 3)) await phonePost({ action: "record", id, date: phoneToday, value: 1, done: true, version: 0 });
    await phonePost({ action: "save-question", question: { id: crypto.randomUUID(), version: 0, subject: "Matemática", topic: "Geometria plana", date: phoneToday, total: 20, correct: 14 } });
    const phone = await phoneCtx.newPage();
    for (const width of [390, 767]) {
      await phone.setViewportSize({ width, height: 844 });
      await goShell(phone, "/rotina");
      await expectFields(phone, `rotina ${width}`, 2);
      await goShell(phone, "/planos");
      await expectFields(phone, `planos ${width}`, 1);
      await goShell(phone, "/perfil");
      await expectFields(phone, `perfil ${width}`, 4);
      // quick-add habit form
      await goShell(phone, "/rotina");
      await phone.evaluate(() => window.dispatchEvent(new CustomEvent("aristo:add", { detail: { kind: "habit", date: new Date().toISOString().slice(0, 10) } })));
      await phone.getByRole("button", { name: "Criar hábito", exact: true }).waitFor();
      await expectFields(phone, `quick-add ${width}`, 1);
      await phone.keyboard.press("Escape");
      // weekly planner session form
      await goShell(phone, "/planos");
      await phone.getByRole("button", { name: /Nova sessão/ }).first().click();
      await phone.getByLabel("Matéria da sessão").waitFor();
      await expectFields(phone, `planner session form ${width}`, 3);
      await phone.keyboard.press("Escape");
    }
    // login / register / recovery (no session)
    const anonPhone = await browser.newContext(iphone);
    const anonPhonePage = await anonPhone.newPage();
    await anonPhonePage.goto(base + "/");
    await anonPhonePage.locator(".auth-card .primary-button").waitFor();
    await expectFields(anonPhonePage, "login", 2);
    // mentor / admin screens
    const mentorPhone = await browser.newContext(iphone);
    const mentorPhoneEmail = `iphone-mentor-${Date.now()}@example.test`;
    assert.equal(
      (await mentorPhone.request.post(base + "/api/auth", { headers: { Origin: base }, data: { action: "register", name: "Mentor iPhone", email: mentorPhoneEmail, password: "Testando-2026!" } })).status(),
      201,
    );
    await asOwner("UPDATE users SET role='mentor' WHERE email=?", [mentorPhoneEmail]);
    const mentorPhonePage = await mentorPhone.newPage();
    await mentorPhonePage.route("**/api/study", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const json = await res.json();
      json.platformAdmin = true;
      await route.fulfill({ response: res, json });
    });
    await mentorPhonePage.route("**/api/admin", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { members: [{ id: "u1", name: "Arthur", email: "arthur@example.test", role: "student" }] } })
        : route.fulfill({ json: { ok: true } }),
    );
    await goShell(mentorPhonePage, "/mentoria");
    await expectFields(mentorPhonePage, "mentoria", 1);
    await goShell(mentorPhonePage, "/admin");
    await expectFields(mentorPhonePage, "admin create form", 3);
    await mentorPhonePage.getByRole("button", { name: /Redefinir senha de Arthur/ }).click();
    await mentorPhonePage.getByLabel("Nova senha temporária").waitFor();
    await expectFields(mentorPhonePage, "admin reset form", 4);
    await anonPhone.close();
    await mentorPhone.close();

    // (b) scrolling: arriving at the home page by switching route, and by
    // loading it directly, on an iPhone-sized touch viewport.
    await phone.setViewportSize({ width: 390, height: 844 });
    const scrollY = () => phone.evaluate(() => Math.round(window.scrollY));
    const stableAtTop = async (label) => {
      const seen = [];
      for (let i = 0; i < 8; i++) {
        seen.push(await scrollY());
        await phone.waitForTimeout(250);
      }
      assert.ok(seen.every((v) => v === 0), `${label}: scrollY should stay at 0, saw ${seen.join(",")}`);
    };
    await goShell(phone, "/");
    assert.ok((await phone.evaluate(() => document.documentElement.scrollHeight)) > 1200, "the home page must be taller than the screen for this test to mean anything");
    await stableAtTop("direct load of the home page");
    const tab = (name) => phone.locator(".header-navigation").getByRole("link", { name, exact: true }).click();
    for (const [from, start] of [["Rotina", 600], ["Perfil", 1500], ["Calendário", 200], ["Questões", 100]]) {
      await tab(from);
      await phone.locator(".app-shell").waitFor();
      await phone.waitForTimeout(400);
      await phone.evaluate((y) => window.scrollTo(0, y), start);
      await phone.waitForTimeout(200);
      await tab("Início");
      await phone.locator(".streak-highlight").waitFor();
      await stableAtTop(`switching route ${from} -> Início`);
    }
    await goShell(phone, "/");
    await phone.evaluate(() => window.scrollTo(0, 1100));
    await phone.waitForTimeout(200);
    await phone.reload();
    await phone.locator(".streak-highlight").waitFor();
    await stableAtTop("reloading the home page while scrolled");
    // the scale of the visual viewport stays 1 (no zoom on the home screen)
    assert.equal(await phone.evaluate(() => window.visualViewport.scale), 1);
    await phoneCtx.close();
    results.push(
      `iPhone: ${fieldChecks} text fields (rotina, planos, perfil, quick-add, planner form, login, mentoria, admin forms) all >= 16px at 390/767px so iOS does not zoom on focus; the home page opens at the top and stays there on a direct load, when switching route from four scrolled pages and on a reload (iPhone-sized touch viewport)`,
    );
  }
  // Profile card ("Personalização do perfil"): the photo on top, the name and
  // tagline below, nothing over the photo, at every width and in both themes;
  // photo change/removal and the name edit keep working.
  {
    const profileCtx = await browser.newContext({ reducedMotion: "reduce" });
    assert.equal(
      (
        await profileCtx.request.post(base + "/api/auth", {
          headers: { Origin: base },
          data: { action: "register", name: "Maria Aparecida Souza", email: `profile-card-${Date.now()}@example.test`, password: "Testando-2026!" },
        })
      ).status(),
      201,
    );
    const profilePage = await profileCtx.newPage();
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const measureCard = () =>
      profilePage.evaluate(() => {
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
        };
        const parse = (c) => {
          const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?/);
          return m ? { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) } : null;
        };
        const bgOf = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c.a > 0.95) return c.rgb;
          }
          return [255, 255, 255];
        };
        const lum = ([r, g, b]) => {
          const f = (v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const contrast = (el) => {
          const fg = parse(getComputedStyle(el).color).rgb;
          const [hi, lo] = [lum(fg), lum(bgOf(el))].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const identity = document.querySelector(".profile-identity");
        const photo = document.querySelector(".profile-avatar-edit");
        const text = identity.children[1];
        const name = text.querySelector("h2");
        const tagline = text.querySelector("p");
        const camera = document.querySelector(".avatar-edit-button");
        const p = rect(photo);
        const hits = [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.5, 0.15]].map(([fx, fy]) => {
          const el = document.elementFromPoint(p.left + p.w * fx, p.top + p.h * fy);
          return !!el && !!el.closest(".profile-avatar-edit");
        });
        const cr = rect(camera);
        const camHit = document.elementFromPoint(cr.left + cr.w / 2, cr.top + cr.h / 2);
        const nr = rect(name);
        const nameHit = document.elementFromPoint(nr.left + nr.w / 2, nr.top + nr.h / 2);
        const ts = getComputedStyle(text);
        const img = photo.querySelector("img");
        return {
          vw: innerWidth,
          box: rect(identity),
          photo: p,
          text: rect(text),
          photoHits: hits,
          cameraClickable: !!camHit && !!camHit.closest(".avatar-edit-button"),
          nameOnTop: !!nameHit && !!nameHit.closest(".profile-identity > div:nth-child(2)"),
          textMarginTop: ts.marginTop,
          textBorder: ts.borderTopWidth,
          textOverflow: text.scrollWidth > text.clientWidth + 1,
          nameContrast: contrast(name),
          taglineContrast: contrast(tagline),
          hasImg: !!img,
          imgLoaded: img ? img.complete && img.naturalWidth > 0 : null,
          removeVisible: !![...text.querySelectorAll("button")].find((b) => b.textContent.includes("Remover foto") && b.getClientRects().length),
        };
      });
    let cardChecks = 0;
    for (const withPhoto of [false, true]) {
      for (const width of [360, 390, 767, 1440]) {
        await profilePage.setViewportSize({ width, height: 900 });
        await profilePage.goto(base + "/perfil");
        await profilePage.locator(".profile-identity").waitFor();
        if (withPhoto && width === 360) {
          await profilePage.setInputFiles('input[type="file"]', { name: "avatar.png", mimeType: "image/png", buffer: tinyPng });
          await profilePage.getByText("Foto de perfil atualizada.", { exact: true }).waitFor();
        }
        if (withPhoto) await profilePage.locator(".profile-avatar img").waitFor();
        for (const theme of ["dark", "light"]) {
          await profilePage.evaluate((t) => {
            localStorage.setItem("aristo-theme", t);
            document.documentElement.dataset.theme = t;
          }, theme);
          await profilePage.waitForTimeout(150);
          const at = `${withPhoto ? "with photo" : "initials"} ${theme} ${width}`;
          const m = await measureCard();
          assert.ok(m.text.top >= m.photo.bottom - 0.5, `text block overlaps the photo (${at}): photo bottom ${m.photo.bottom}, text top ${m.text.top}`);
          assert.ok(m.photo.w >= 90 && m.photo.h >= 90, `photo is too small (${at}): ${m.photo.w}x${m.photo.h}`);
          for (const [what, r] of [["photo", m.photo], ["text", m.text]])
            assert.ok(r.left >= m.box.left - 0.5 && r.right <= m.box.right + 0.5 && r.left >= 0 && r.right <= m.vw, `${what} sticks out of its box or the screen (${at})`);
          assert.ok(m.photoHits.every(Boolean), `something covers the photo (${at}): ${m.photoHits}`);
          assert.ok(m.cameraClickable, `the camera button is covered (${at})`);
          assert.ok(m.nameOnTop, `the name is not the top element at its own centre (${at})`);
          assert.equal(m.textMarginTop, "0px", `text block still has a negative/odd top margin (${at})`);
          assert.equal(m.textBorder, "0px", `text block still has a border (${at})`);
          assert.equal(m.textOverflow, false, `text overflows its block (${at})`);
          assert.ok(m.nameContrast >= 4.5, `name contrast ${m.nameContrast.toFixed(2)} (${at})`);
          assert.ok(m.taglineContrast >= 4.5, `tagline contrast ${m.taglineContrast.toFixed(2)} (${at})`);
          if (withPhoto) {
            assert.ok(m.hasImg && m.imgLoaded, `the photo did not load (${at})`);
            assert.ok(m.removeVisible, `"Remover foto" is not visible (${at})`);
          }
          cardChecks++;
        }
      }
    }
    // The behaviour behind the card is unchanged: remove the photo, edit the name.
    await profilePage.setViewportSize({ width: 390, height: 900 });
    await profilePage.goto(base + "/perfil");
    await profilePage.getByRole("button", { name: "Remover foto", exact: true }).click();
    await profilePage.getByText("Foto de perfil removida.", { exact: true }).waitFor();
    assert.equal(await profilePage.locator(".profile-avatar img").count(), 0, "photo removed, initials shown");
    await profilePage.locator('input[name="name"]').fill("Maria A. Souza");
    await profilePage.getByRole("button", { name: "Salvar perfil" }).click();
    await profilePage.getByText("Perfil atualizado.", { exact: true }).waitFor();
    assert.equal(await profilePage.locator(".profile-identity h2").innerText(), "Maria A. Souza");
    assert.equal(await profilePage.locator('input[type="email"], input[disabled]').first().isDisabled(), true, "the e-mail field stays read-only");
    await profileCtx.close();
    results.push(
      `profile card: photo above and text below with no overlap, photo complete (96px, nothing covers it, camera button clickable), name/tagline contrast >= 4.5:1, no overflow — ${cardChecks} checks with initials and with an uploaded photo at 360/390/767/1440px in both themes; photo removal and name edit still work`,
    );
  }
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

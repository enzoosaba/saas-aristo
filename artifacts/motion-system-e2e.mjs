import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.TEST_BASE_URL || "http://localhost:3101";
const output = "test-results/motion-system";
mkdirSync(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});

function style(locator) {
  return locator.evaluate((element) => {
    const value = getComputedStyle(element);
    return {
      animationName: value.animationName,
      animationDuration: value.animationDuration,
      transitionDuration: value.transitionDuration,
      transform: value.transform,
    };
  });
}

async function register(context, suffix) {
  const response = await context.request.post(base + "/api/auth", {
    headers: { Origin: base },
    data: {
      action: "register",
      name: "Aluno Motion",
      email: `motion-${suffix}-${Date.now()}@example.test`,
      password: "Testando-2026!",
    },
  });
  assert.equal(response.status(), 201);
}

async function createHabit(page, title) {
  await page
    .getByRole("button", { name: "Adicionar hábito ou tarefa" })
    .click();
  await page.locator(".quick-add-dialog[open]").waitFor();
  await page.locator(".quick-add-options button").first().click();
  await page.getByLabel("Nome", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Criar hábito", exact: true }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
}

async function exercise(width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: "no-preference",
    recordVideo: { dir: output, size: { width, height: 1000 } },
  });
  await register(context, `full-${width}`);
  const page = await context.newPage();
  await page.goto(base);
  await page.locator(".app-shell").waitFor();

  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return [
      "--motion-fast",
      "--motion-base",
      "--motion-slow",
      "--ease-out",
      "--ease-in",
    ].map((token) => root.getPropertyValue(token).trim());
  });
  assert.deepEqual(tokens, [
    ".15s",
    ".25s",
    ".4s",
    "cubic-bezier(.16, 1, .3, 1)",
    "cubic-bezier(.7, 0, .84, 0)",
  ]);

  const missions = page.locator(".missions-panel").first();
  await missions.getByRole("button", { name: "Semana", exact: true }).click();
  const missionPanel = missions.locator(
    width < 768 ? ".mobile-mission-content" : ".desktop-mission-content",
  );
  assert.deepEqual(await style(missionPanel), {
    animationName: "tab-content-in",
    animationDuration: "0.25s",
    transitionDuration: "0s",
    transform: "none",
  });
  await page.screenshot({ path: `${output}/${width}-tabs-missoes.png` });

  await page
    .getByRole("button", { name: "Desempenho", exact: true })
    .click();
  assert.equal(
    (await style(page.locator(".home-section-content"))).animationName,
    "tab-content-in",
  );
  await page.screenshot({ path: `${output}/${width}-tabs-desempenho.png` });

  await page.goto(base + "/rotina");
  const quickAdd = page.getByRole("button", {
    name: "Adicionar hábito ou tarefa",
  });
  await quickAdd.click();
  await page.locator(".quick-add-dialog[open]").waitFor();
  assert.equal(await quickAdd.getAttribute("aria-expanded"), "true");
  assert.equal(
    (await style(page.locator(".quick-add-dialog"))).animationName,
    "panel-scale-in",
  );
  await page.waitForTimeout(170);
  assert.notEqual((await style(quickAdd.locator("svg"))).transform, "none");
  await page.screenshot({ path: `${output}/${width}-botao-mais-habito.png` });
  await page.keyboard.press("Escape");

  const habit = `Hábito Motion ${width}`;
  await createHabit(page, habit);
  const done = page
    .locator(".personal-item", { hasText: habit })
    .locator(".personal-done");
  await done.click();
  const check = done.locator(".habit-check-complete");
  const toast = page.locator(".event-toast");
  await toast.waitFor();
  assert.equal((await style(check)).animationName, "habit-check-in");
  assert.equal((await style(check)).animationDuration, "0.15s");
  assert.equal((await style(toast)).animationName, "toast-in");
  assert.equal(await page.locator(".event-toast").count(), 1);
  await page.screenshot({ path: `${output}/${width}-check-toast.png` });
  await toast.waitFor({ state: "detached", timeout: 4000 });

  await page.goto(base + "/planos");
  const newSession = page.getByRole("button", {
    name: "Nova sessão",
    exact: true,
  });
  await newSession.click();
  await page.locator(".session-dialog[open]").waitFor();
  assert.equal(await newSession.getAttribute("aria-expanded"), "true");
  assert.equal(
    (await style(page.locator(".session-dialog"))).animationName,
    "panel-scale-in",
  );
  await page.waitForTimeout(170);
  assert.notEqual((await style(newSession.locator("svg"))).transform, "none");
  await page.screenshot({ path: `${output}/${width}-botao-mais-sessao.png` });

  const video = page.video();
  await page.close();
  await context.close();
  await video?.saveAs(`${output}/${width}-motion.webm`);
}

async function exerciseReducedMotion(width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
  await register(context, `reduced-${width}`);
  const page = await context.newPage();
  await page.goto(base);
  const missions = page.locator(".missions-panel").first();
  await missions.getByRole("button", { name: "Semana", exact: true }).click();
  const missionPanel = missions.locator(
    width < 768 ? ".mobile-mission-content" : ".desktop-mission-content",
  );
  assert.equal((await style(missionPanel)).animationName, "none");

  await page.goto(base + "/rotina");
  const quickAdd = page.getByRole("button", {
    name: "Adicionar hábito ou tarefa",
  });
  await quickAdd.click();
  assert.equal(
    (await style(page.locator(".quick-add-dialog"))).animationName,
    "none",
  );
  assert.equal((await style(quickAdd.locator("svg"))).transitionDuration, "0s");
  await page.keyboard.press("Escape");

  const habit = `Hábito sem movimento ${width}`;
  await createHabit(page, habit);
  const done = page
    .locator(".personal-item", { hasText: habit })
    .locator(".personal-done");
  await done.click();
  assert.equal(
    (await style(done.locator(".habit-check-complete"))).animationName,
    "none",
  );
  assert.equal(
    (await style(page.locator(".event-toast"))).animationName,
    "none",
  );
  await page.screenshot({ path: `${output}/${width}-reduced-motion.png` });
  await context.close();
}

try {
  for (const width of [390, 1440]) await exercise(width);
  for (const width of [390, 1440]) await exerciseReducedMotion(width);
  console.log(
    JSON.stringify({
      viewports: [390, 1440],
      motion: ["check", "tabs", "toast", "plus-panel"],
      reducedMotion: "passed",
      evidence: output,
    }),
  );
} finally {
  await browser.close();
}

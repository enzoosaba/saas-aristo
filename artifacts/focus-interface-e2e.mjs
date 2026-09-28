import assert from "node:assert/strict";
import { chromium } from "playwright";

if (!process.env.TEST_DATABASE_URL) {
  console.log(JSON.stringify({ focusInterface: "skipped without disposable PostgreSQL" }));
  process.exit(0);
}

const base = process.env.TEST_BASE_URL || "http://localhost:3101";
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});

async function register(context, width) {
  const response = await context.request.post(base + "/api/auth", {
    headers: { Origin: base },
    data: {
      action: "register",
      name: `Relógio ${width}`,
      email: `focus-ui-${width}-${Date.now()}@example.test`,
      password: "Focus-E2E-2026!",
    },
  });
  assert.equal(response.status(), 201);
}

async function assertPlacement(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await register(context, width);
  const page = await context.newPage();
  await page.goto(base);
  await page.locator(".app-shell").waitFor();
  await page.locator(".header-focus-timer > summary").waitFor();
  assert.equal(await page.locator(".site-header .theme-toggle").count(), 0);
  assert.equal(await page.locator(".missions-panel .focus-timer").count(), 0);
  await page.goto(base + "/perfil");
  await page.getByText("Aparência", { exact: true }).waitFor();
  assert.equal(await page.locator(".profile-theme-setting .theme-toggle").count(), 1);
  await context.close();
}

async function exerciseTimer() {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await register(context, "flow");
  const initial = await (await context.request.get(base + "/api/study")).json();
  const completedPlanId = crypto.randomUUID();
  const abandonedPlanId = crypto.randomUUID();
  const saveSession = (id, title, start) => context.request.post(base + "/api/study", {
    headers: { Origin: base },
    data: {
      action: "save-session",
      session: {
        id,
        title,
        subject: "Matemática",
        date: initial.today,
        start,
        duration: 30,
        notes: "",
        version: 0,
      },
    },
  });
  assert.equal((await saveSession(completedPlanId, "Sessão para concluir", "08:00")).status(), 200);
  assert.equal((await saveSession(abandonedPlanId, "Sessão para abandonar", "09:00")).status(), 200);
  const page = await context.newPage();
  await page.goto(base);
  await page.locator(".header-focus-timer > summary").click();
  const timer = page.locator(".header-focus-timer-popover");
  await timer.getByLabel(/Sessão planejada de hoje/).selectOption(completedPlanId);

  await timer.getByRole("button", { name: "Iniciar", exact: true }).click();
  await timer.getByText("Sessão em andamento", { exact: true }).waitFor();
  assert.equal(await timer.getByRole("button", { name: "Iniciar", exact: true }).count(), 0);

  await page.reload();
  await page.locator(".header-focus-timer > summary").click();
  await timer.getByText("Sessão em andamento", { exact: true }).waitFor();

  let failedOnce = false;
  await page.route("**/api/study", async (route, request) => {
    if (!failedOnce && request.method() === "POST") {
      failedOnce = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await timer.getByRole("button", { name: "Pausar", exact: true }).click();
  await timer.getByRole("alert").waitFor();
  await timer.getByRole("button", { name: "Pausar", exact: true }).waitFor({ state: "visible" });
  assert.equal(await timer.getByRole("button", { name: "Pausar", exact: true }).isEnabled(), true);
  await page.unroute("**/api/study");

  await timer.getByRole("button", { name: "Pausar", exact: true }).click();
  await timer.getByText("Sessão pausada", { exact: true }).waitFor();
  await timer.getByLabel("Motivo da pausa").fill("Intervalo para água");
  await timer.getByRole("button", { name: "Retomar", exact: true }).click();
  await timer.getByText("Sessão em andamento", { exact: true }).waitFor();
  await timer.getByRole("button", { name: "Encerrar", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".header-focus-timer")?.hasAttribute("open"));
  await page.locator(".header-focus-timer > summary").click();
  await timer.getByText("Concluída · 0 min líquidos", { exact: true }).waitFor();
  assert.equal(await timer.getByRole("button", { name: "Iniciar", exact: true }).isEnabled(), true);

  await timer.getByLabel(/Sessão planejada de hoje/).selectOption(abandonedPlanId);
  await timer.getByRole("button", { name: "Iniciar", exact: true }).click();
  await timer.getByText("Em andamento", { exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await timer.getByRole("button", { name: "Abandonar", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".header-focus-timer")?.hasAttribute("open"));
  await page.locator(".header-focus-timer > summary").click();
  await timer.getByText("Abandonada · 0 min líquidos", { exact: true }).waitFor();

  const final = await (await context.request.get(base + "/api/study")).json();
  const completed = final.sessions.find((session) => session.id === completedPlanId);
  const abandoned = final.sessions.find((session) => session.id === abandonedPlanId);
  assert.equal(completed.status, "completed");
  assert.equal(completed.netFocusMinutes, 0);
  assert.equal(abandoned.status, "abandoned");
  assert.equal(abandoned.netFocusMinutes, 0);
  await context.close();
}

try {
  await assertPlacement(390);
  await assertPlacement(1440);
  await exerciseTimer();
  console.log(JSON.stringify({
    focusInterface: "passed",
    placementWidths: [390, 1440],
    covered: ["start", "planned-link", "single-active", "reload", "network-retry", "pause", "resume-with-reason", "end", "abandon"],
  }));
} finally {
  await browser.close();
}

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
  const page = await context.newPage();
  await page.goto(base);
  await page.locator(".header-focus-timer > summary").click();
  const timer = page.locator(".header-focus-timer-popover");

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
  await timer.getByText("Pronto para começar", { exact: true }).waitFor();
  assert.equal(await timer.getByRole("button", { name: "Iniciar", exact: true }).isEnabled(), true);
  await context.close();
}

try {
  await assertPlacement(390);
  await assertPlacement(1440);
  await exerciseTimer();
  console.log(JSON.stringify({
    focusInterface: "passed",
    placementWidths: [390, 1440],
    covered: ["start", "single-active", "reload", "network-retry", "pause", "resume-with-reason", "end"],
  }));
} finally {
  await browser.close();
}

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.TEST_BASE_URL || "http://localhost:3101";
const output = "test-results/count-stepper";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});

async function exercise(width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
  });
  await context.request.post(base + "/api/auth", {
    headers: { Origin: base },
    data: {
      action: "register",
      name: "Aluno Contador",
      email: `counter-${width}-${Date.now()}@example.test`,
      password: "Testando-2026!",
    },
  });
  const state = async () =>
    (await context.request.get(base + "/api/study")).json();
  const today = (await state()).today;
  const save = (id, title, target, unit) =>
    context.request.post(base + "/api/study", {
      headers: { Origin: base },
      data: {
        action: "save-item",
        item: {
          id,
          kind: "habit",
          title,
          notes: "",
          frequency: "Todos os dias",
          measure: "count",
          target,
          unit,
          value: 0,
          date: today,
          time: "",
          priority: "Normal",
          done: false,
        },
      },
    });
  const readingId = crypto.randomUUID();
  const studyId = crypto.randomUUID();
  assert.equal(
    (await save(readingId, "Leitura smoke", 20, "páginas")).status(),
    200,
  );
  assert.equal(
    (await save(studyId, "Estudo smoke", 200, "minutos")).status(),
    200,
  );
  const directRecord = (value) =>
    context.request.post(base + "/api/study", {
      headers: { Origin: base },
      data: {
        action: "record",
        id: readingId,
        date: today,
        value,
        done: false,
        version: 0,
      },
    });
  for (const invalid of [-1, 1.5, "20", 21])
    assert.equal((await directRecord(invalid)).status(), 400);
  assert.equal((await state()).records.length, 0);

  const page = await context.newPage();
  await page.goto(base + "/rotina");
  const reading = page.locator(".personal-item", { hasText: "Leitura smoke" });
  const study = page.locator(".personal-item", { hasText: "Estudo smoke" });
  for (const step of [1, 5, 10])
    await reading
      .getByRole("button", { name: `+${step}`, exact: true })
      .waitFor();
  for (const step of [10, 30, 60])
    await study
      .getByRole("button", { name: `+${step}`, exact: true })
      .waitFor();

  await reading.getByRole("button", { name: "+5", exact: true }).click();
  await reading.getByText("5 / 20 páginas", { exact: true }).waitFor();
  await reading.getByRole("button", { name: /Editar valor/ }).click();
  await reading.getByLabel("Valor atual de Leitura smoke").fill("999");
  await reading.getByRole("button", { name: "Salvar", exact: true }).click();
  await reading.getByText("20 / 20 páginas", { exact: true }).waitFor();
  await page
    .getByText("Leitura smoke concluído. Muito bem!", { exact: true })
    .waitFor();

  await reading.getByRole("button", { name: /Editar valor/ }).click();
  await reading.getByLabel("Valor atual de Leitura smoke").fill("-8");
  await reading.getByRole("button", { name: "Salvar", exact: true }).click();
  await reading.getByText("0 / 20 páginas", { exact: true }).waitFor();
  await reading.getByRole("button", { name: "Aumentar Leitura smoke" }).click();
  await reading.getByText("1 / 20 páginas", { exact: true }).waitFor();
  await reading.getByRole("button", { name: "Diminuir Leitura smoke" }).click();
  await reading.getByText("0 / 20 páginas", { exact: true }).waitFor();

  await study.getByRole("button", { name: /Editar valor/ }).click();
  await study.getByLabel("Valor atual de Estudo smoke").fill("180");
  await page
    .locator(".personal-items-grid")
    .screenshot({ path: `${output}/${width}-direct-edit.png` });
  await study.getByRole("button", { name: "Salvar", exact: true }).click();
  await study.getByText("180 / 200 minutos", { exact: true }).waitFor();
  await study.getByRole("button", { name: "+60", exact: true }).click();
  await study.getByText("200 / 200 minutos", { exact: true }).waitFor();
  await page
    .getByText("Estudo smoke concluído. Muito bem!", { exact: true })
    .waitFor();
  await page.waitForTimeout(500);
  await page
    .locator(".personal-items-grid")
    .screenshot({ path: `${output}/${width}-count-controls.png` });

  await page.reload();
  await page.locator(".app-shell").waitFor();
  await page.getByText("0 / 20 páginas", { exact: true }).waitFor();
  await page.getByText("200 / 200 minutos", { exact: true }).waitFor();
  const records = (await state()).records;
  assert.equal(records.filter((record) => record.done).length, 1);
  await context.close();
}

try {
  await exercise(390);
  await exercise(1440);
  console.log(
    JSON.stringify({
      viewports: [390, 1440],
      direct: true,
      quickSteps: true,
      fineStep: true,
      clamp: true,
      persistence: true,
      evidence: output,
    }),
  );
} finally {
  await browser.close();
}

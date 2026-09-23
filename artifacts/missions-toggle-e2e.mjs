import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = process.env.TEST_BASE_URL || "http://localhost:3108";
const stage = process.env.MISSIONS_STAGE || "after";
const output = "test-results/missions-toggle";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const context = await browser.newContext({ reducedMotion: "reduce" });
const failures = [];
const measurements = {};
try {
  const response = await context.request.post(base + "/api/auth", {
    headers: { Origin: base },
    data: {
      action: "register",
      name: "Aluno Visual",
      email: `missions-${Date.now()}@example.test`,
      password: "Testando-2026!",
    },
  });
  assert.equal(response.status(), 201);
  const page = await context.newPage();
  for (const width of [390, 1440])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        (t) => localStorage.setItem("aristo-theme", t),
        theme,
      );
      await page.goto(base);
      const toggle = page.locator(".missions-panel .period-switch");
      await toggle.waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const period of ["Hoje", "Semana"]) {
        await toggle.getByRole("button", { name: period, exact: true }).click();
        await page.mouse.move(0, 0);
        await toggle
          .getByRole("button", { name: period, exact: true })
          .evaluate((e) => e.blur());
        const key = `${width}-${theme}-${period}`;
        const visual = await toggle.evaluate((el) => {
          const style = getComputedStyle(el);
          const geometry = (e) => e.getBoundingClientRect().toJSON();
          return {
            background: style.backgroundColor,
            image: style.backgroundImage,
            borders: ["Top", "Right", "Bottom", "Left"].map((side) => ({
              width: style[`border${side}Width`],
              color: style[`border${side}Color`],
            })),
            layout: [
              ...document.querySelectorAll(
                ".missions-panel, .missions-panel *",
              ),
            ].map(geometry),
            buttons: [...el.children].map((e) => {
              const s = getComputedStyle(e);
              return [
                s.background,
                s.color,
                s.border,
                s.borderRadius,
                s.padding,
                s.font,
                geometry(e),
              ];
            }),
          };
        });
        measurements[key] = visual;
        await page.screenshot({
          path: `${output}/${stage}-${key}.png`,
          fullPage: true,
        });
        const masked = await page.screenshot({
          fullPage: true,
          mask: [toggle],
        });
        writeFileSync(`${output}/${stage}-${key}-masked.png`, masked);
        if (process.env.MISSIONS_COMPARE === "1") {
          const before = JSON.parse(
            readFileSync(`${output}/before.json`, "utf8"),
          )[key];
          assert.deepEqual(
            visual.layout,
            before.layout,
            `${key}: card geometry changed`,
          );
          assert.deepEqual(
            visual.buttons,
            before.buttons,
            `${key}: button appearance changed`,
          );
          assert.ok(
            masked.equals(readFileSync(`${output}/before-${key}-masked.png`)),
            `${key}: pixels outside toggle changed`,
          );
        }
        if (
          visual.background !== "rgba(0, 0, 0, 0)" ||
          visual.image !== "none" ||
          visual.borders.some(
            (b) => b.width !== "0px" && b.color !== "rgba(0, 0, 0, 0)",
          )
        ) {
          failures.push(
            `${key}: container paints ${visual.background}, borders ${JSON.stringify(visual.borders)}`,
          );
        }
        assert.equal(
          await toggle
            .getByRole("button", { name: period, exact: true })
            .getAttribute("aria-pressed"),
          "true",
        );
      }
    }
  writeFileSync(
    `${output}/${stage}.json`,
    JSON.stringify(measurements, null, 2),
  );
  assert.deepEqual(
    failures,
    [],
    "Mission toggle must not paint a rectangle behind its buttons",
  );
  console.log(
    "PASS: mission toggle, 2 widths x 2 themes x 2 periods" +
      (process.env.MISSIONS_COMPARE === "1"
        ? "; unchanged geometry, button styles and pixels outside toggle"
        : ""),
  );
} finally {
  await browser.close();
}

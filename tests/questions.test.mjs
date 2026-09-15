import { test } from "node:test";
import assert from "node:assert/strict";
import { questionAnalytics, QUESTION_AREAS } from "../src/lib/domain.ts";
const today = "2026-09-09";
function log(date, subject, topic, total, correct) {
  return { id: date + topic, date, subject, topic, total, correct, version: 1 };
}
test("period window includes today and excludes older days", () => {
  const rows = [
    log(today, "Matemática", "funções", 10, 5),
    log("2026-09-03", "Matemática", "funções", 10, 10),
    log("2026-09-02", "Matemática", "funções", 10, 0),
  ];
  const week = questionAnalytics(rows, today, 7);
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0], "2026-09-03");
  assert.equal(week.days[6], today);
  assert.equal(week.total, 20);
  assert.equal(week.correct, 15);
  const month = questionAnalytics(rows, today, 30);
  assert.equal(month.total, 30);
  assert.equal(month.correct, 15);
});
test("future records are ignored", () => {
  const result = questionAnalytics(
    [log("2026-09-10", "Física", "cinemática", 40, 40)],
    today,
    7,
  );
  assert.equal(result.total, 0);
  assert.equal(result.percent, 0);
});
test("accuracy weighs questions, not days", () => {
  const result = questionAnalytics(
    [
      log(today, "Humanas", "história", 90, 45),
      log("2026-09-08", "Humanas", "história", 10, 10),
    ],
    today,
    7,
  );
  assert.equal(result.total, 100);
  assert.equal(result.percent, 55);
});
test("cumulative accuracy is weighted and null before the first record", () => {
  const result = questionAnalytics(
    [
      log("2026-09-08", "Química", "estequiometria", 10, 2),
      log(today, "Química", "estequiometria", 30, 18),
    ],
    today,
    7,
  );
  assert.deepEqual(result.cumulative.slice(0, 5), [
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.equal(result.cumulative[5], 0.2);
  assert.equal(result.cumulative[6], 0.5);
});
test("area breakdown covers every area and stays at zero without practice", () => {
  const result = questionAnalytics(
    [log(today, "Biologia", "genética", 8, 6)],
    today,
    7,
  );
  assert.deepEqual(
    result.areaStats.map((a) => a.name),
    QUESTION_AREAS,
  );
  const bio = result.areaStats.find((a) => a.name === "Biologia");
  assert.equal(bio.total, 8);
  assert.equal(bio.percent, 75);
  for (const area of result.areaStats.filter((a) => a.name !== "Biologia")) {
    assert.equal(area.total, 0);
    assert.equal(area.percent, 0);
  }
});
test("review topics rank by errors, merge repeats and drop perfect scores", () => {
  const result = questionAnalytics(
    [
      log(today, "Matemática", "geometria", 20, 5),
      log("2026-09-08", "Matemática", "geometria", 10, 8),
      log(today, "Física", "óptica", 30, 10),
      log(today, "Linguagens", "interpretação", 10, 10),
    ],
    today,
    7,
  );
  assert.deepEqual(
    result.topics.map((t) => [t.label, t.errors]),
    [
      ["Física: óptica", 20],
      ["Matemática: geometria", 17],
    ],
  );
});
test("empty history produces a usable chart scale", () => {
  const result = questionAnalytics([], today, 7);
  assert.equal(result.total, 0);
  assert.equal(result.percent, 0);
  assert.equal(result.max, 1);
  assert.deepEqual(result.topics, []);
  assert.equal(
    result.cumulative.every((v) => v === null),
    true,
  );
});

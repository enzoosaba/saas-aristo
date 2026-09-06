import { test } from "node:test";
import assert from "node:assert/strict";
import { isScheduled, dayOffset, progress } from "../src/lib/domain.ts";
const habit = {
  id: "h",
  kind: "habit",
  date: "2026-09-01",
  frequency: "Segunda a sexta",
};
test("weekday recurrence and start boundary", () => {
  assert.equal(isScheduled(habit, "2026-09-04"), true);
  assert.equal(isScheduled(habit, "2026-09-05"), false);
  assert.equal(isScheduled(habit, "2026-08-31"), false);
});
test("weekend recurrence", () => {
  assert.equal(
    isScheduled({ ...habit, frequency: "Fins de semana" }, "2026-09-05"),
    true,
  );
  assert.equal(
    isScheduled({ ...habit, frequency: "Fins de semana" }, "2026-09-07"),
    false,
  );
});
test("date arithmetic crosses month/year boundaries", () => {
  assert.equal(dayOffset("2027-01-01", -1), "2026-12-31");
  assert.equal(dayOffset("2028-02-28", 1), "2028-02-29");
});
test("XP derives from completed records and is reversible", () => {
  const records = [
    { itemId: "h", date: "2026-09-04", done: true },
    { itemId: "h", date: "2026-09-03", done: false },
  ];
  assert.equal(progress([habit], records, "2026-09-04").xp, 20);
  assert.equal(
    progress(
      [habit],
      records.map((r) => ({ ...r, done: false })),
      "2026-09-04",
    ).xp,
    0,
  );
});
test("streak tolerates today pending and breaks at missing day", () => {
  const records = ["2026-09-03", "2026-09-04"].map((date) => ({
    date,
    done: true,
  }));
  assert.equal(progress([], records, "2026-09-05").streak, 2);
  assert.equal(progress([], records, "2026-09-06").streak, 0);
});

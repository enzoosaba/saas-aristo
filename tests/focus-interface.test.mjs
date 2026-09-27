import test from "node:test";
import assert from "node:assert/strict";
import {
  elapsedFocusSeconds,
  focusControls,
  focusVisualState,
  formatFocusTime,
} from "../src/lib/focus.ts";
import {
  executeFocusCommand,
  focusConflictMessage,
} from "../src/server/focus.ts";

const idle = { active: null, creditedTodaySeconds: 120 };
const running = {
  active: {
    id: "session",
    status: "RUNNING",
    elapsedSeconds: 30,
    measuredAt: "2026-09-27T12:00:00.000Z",
  },
  creditedTodaySeconds: 120,
};
const paused = {
  ...running,
  active: { ...running.active, status: "PAUSED" },
};

test("focus interface exposes the controls for idle/ended, running, and paused states", () => {
  assert.equal(focusVisualState(idle), "IDLE");
  assert.deepEqual(focusControls(idle), ["start"]);
  assert.equal(focusVisualState(running), "RUNNING");
  assert.deepEqual(focusControls(running), ["pause", "end"]);
  assert.equal(focusVisualState(paused), "PAUSED");
  assert.deepEqual(focusControls(paused), ["resume", "end"]);
  // An ended session is absent from the active projection and returns to idle.
  assert.deepEqual(focusControls({ ...idle, active: null }), ["start"]);
});

test("running time advances while paused time remains stable", () => {
  assert.equal(
    elapsedFocusSeconds(running, Date.parse("2026-09-27T12:00:15.000Z")),
    45,
  );
  assert.equal(
    elapsedFocusSeconds(paused, Date.parse("2026-09-27T12:00:15.000Z")),
    30,
  );
  assert.equal(formatFocusTime(3661), "01:01:01");
});

test("P0001 and P0002 conflicts become stable friendly messages", () => {
  assert.match(focusConflictMessage("P0001", "focus session already active"), /sessão de foco ativa/);
  assert.match(focusConflictMessage("P0001", "invalid focus session transition"), /estado da sessão mudou/);
  assert.match(focusConflictMessage("P0002"), /dados diferentes/);
  assert.equal(focusConflictMessage("42501"), null);
});

test("all four focus commands call their matching database function", async () => {
  const calls = [];
  const dependencies = {
    transaction: async (work) => work(),
    call: async (sql, values) => calls.push({ sql, values }),
  };
  await executeFocusCommand("student", { action: "focus-start", commandId: "c1" }, dependencies);
  await executeFocusCommand("student", { action: "focus-pause", commandId: "c2", sessionId: "s" }, dependencies);
  await executeFocusCommand("student", { action: "focus-resume", commandId: "c3", sessionId: "s", reason: "Água" }, dependencies);
  await executeFocusCommand("student", { action: "focus-end", commandId: "c4", sessionId: "s" }, dependencies);
  assert.deepEqual(calls.map((call) => call.sql), ["start", "pause", "resume", "end", "sync"]);
});

test("achievement sync starts only after the end transaction committed", async () => {
  const events = [];
  let transactionNumber = 0;
  await executeFocusCommand(
    "student",
    { action: "focus-end", commandId: "command", sessionId: "session" },
    {
      transaction: async (work) => {
        const number = ++transactionNumber;
        events.push(`begin-${number}`);
        const result = await work();
        events.push(`commit-${number}`);
        return result;
      },
      call: async (command) => events.push(command),
    },
  );
  assert.deepEqual(events, ["begin-1", "end", "commit-1", "begin-2", "sync", "commit-2"]);
});

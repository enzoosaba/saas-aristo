import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the focus timer occupies the authenticated top bar and leaves the missions card", () => {
  const topBar = source("src/components/TopBar.tsx");
  const missions = source("src/components/StudyPanels.tsx");
  assert.match(topBar, /<FocusTimer placement="header" \/>/);
  assert.doesNotMatch(missions, /<FocusTimer/);
});

test("theme selection exists only in Profile", () => {
  const topBar = source("src/components/TopBar.tsx");
  const auth = source("src/components/auth/AuthForm.tsx");
  const profile = source("src/app/perfil/page.tsx");
  assert.doesNotMatch(topBar, /ThemeToggle/);
  assert.doesNotMatch(auth, /ThemeToggle/);
  assert.match(profile, /<ThemeToggle \/>/);
});

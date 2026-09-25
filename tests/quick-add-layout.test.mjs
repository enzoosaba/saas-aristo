import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("quick-add paired fields can shrink inside the mobile grid", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(
    css,
    /\.quick-add-fields\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/,
  );
  assert.match(
    css,
    /\.quick-add-form input,[^{]*\{[^}]*min-width:0;[^}]*max-width:100%/,
  );
});

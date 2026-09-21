import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

// Row-count discipline. Under RLS a write the policy refuses does not fail: it
// affects 0 rows and returns success. So an UPDATE whose result is thrown away
// can "succeed" while changing nothing — the app then reports success to the
// user (e.g. "Senha atualizada" with the old password still in place).
//
// Rule: in the files listed below, the result of every  .prepare("UPDATE ...").run(...)
// must be kept and its .changes looked at. Extend CHECKED_FILES as more code is
// brought under the rule.

export const CHECKED_FILES = [
  "src/app/api/auth/recovery/route.ts",
  "src/app/api/auth/route.ts",
];

const parse = (text, name) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}
const stringLiteralText = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

// returns the violations found in one source text
export function auditUpdateResults(text, name) {
  const sf = parse(text, name);
  const violations = [];
  walk(sf, (node) => {
    // X.prepare("UPDATE ...").run(...)
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "run") return;
    const prepare = node.expression.expression;
    if (!ts.isCallExpression(prepare) || !ts.isPropertyAccessExpression(prepare.expression) || prepare.expression.name.text !== "prepare") return;
    const sql = stringLiteralText(prepare.arguments[0]);
    if (!sql || !/^\s*UPDATE\b/i.test(sql)) return;
    const where = `${name}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const label = sql.replace(/\s+/g, " ").slice(0, 60);
    // climb through await/parentheses to see what the result is used for
    let use = node;
    while (use.parent && (ts.isAwaitExpression(use.parent) || ts.isParenthesizedExpression(use.parent))) use = use.parent;
    const parent = use.parent;
    if (ts.isExpressionStatement(parent)) {
      violations.push(`${where}: result of "${label}" is discarded`);
      return;
    }
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      const variable = parent.name.text;
      let scope = parent;
      while (scope.parent && !ts.isFunctionLike(scope.parent)) scope = scope.parent;
      let checked = false;
      walk(scope.parent ?? sf, (n) => {
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === variable && n.name.text === "changes") checked = true;
      });
      if (!checked) violations.push(`${where}: "${label}" result is kept in ${variable} but .changes is never read`);
    }
  });
  return violations;
}

test("UPDATEs in the checked files keep their result and read .changes", () => {
  const violations = CHECKED_FILES.flatMap((f) => auditUpdateResults(readFileSync(f, "utf8"), f));
  assert.deepEqual(violations, []);
  // the audit really found UPDATEs to look at
  const seen = CHECKED_FILES.map((f) => (readFileSync(f, "utf8").match(/prepare\(\s*"UPDATE/g) ?? []).length);
  assert.ok(seen.every((n) => n >= 1), `each checked file must contain an UPDATE (found ${seen})`);
});

test("the UPDATE audit flags discarded and unchecked results and accepts checked ones (fixtures)", () => {
  const src = (body) => `async function f(db: any) {\n${body}\n}`;
  const audit = (body) => auditUpdateResults(src(body), "fixture.ts");
  assert.equal(audit(`await db().prepare("UPDATE users SET password=? WHERE id=?").run(1, 2);`).length, 1);
  assert.equal(audit(`const r = await db().prepare("UPDATE users SET name=? WHERE id=?").run(1, 2); return r;`).length, 1);
  assert.deepEqual(audit(`const r = await db().prepare("UPDATE users SET name=? WHERE id=?").run(1, 2); if (!r.changes) throw new Error("x");`), []);
  assert.deepEqual(audit(`await db().prepare("DELETE FROM sessions WHERE user_id=?").run(1);`), [], "only UPDATEs are in scope");
  assert.deepEqual(audit(`await db().prepare("SELECT 1").get();`), []);
});

test("why it matters: under RLS a write with no actor changes 0 rows and does NOT fail", async () => {
  const db = new PGlite();
  try {
    for (const file of readdirSync("supabase/migrations").sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.exec("GRANT aristo_app TO postgres");
    await db.exec("INSERT INTO aristo.users(id,name,email,password,role,created_at) VALUES ('u1','U','u1@example.test','old','student',0)");
    const asApp = async (actor, sql, params) => {
      await db.exec("BEGIN");
      await db.exec("SET ROLE aristo_app");
      try {
        await db.query("SELECT set_config('app.user_id', $1, true)", [actor ?? ""]);
        const result = await db.query(sql, params);
        await db.exec("COMMIT");
        return result;
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      } finally {
        await db.exec("RESET ROLE");
      }
    };
    const update = "UPDATE aristo.users SET password=$1 WHERE id='u1'";
    const lost = await asApp(null, update, ["changed-without-actor"]);
    assert.equal(lost.affectedRows, 0, "no error, no change: the case the .changes check exists for");
    assert.equal((await db.query("SELECT password FROM aristo.users WHERE id='u1'")).rows[0].password, "old");
    const own = await asApp("u1", update, ["changed-by-owner-of-the-row"]);
    assert.equal(own.affectedRows, 1);
  } finally {
    await db.close();
  }
});

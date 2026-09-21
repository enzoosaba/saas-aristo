import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { withActor, currentActorId } from "../src/server/actor.ts";

// Regression guard for the bug class that made every RLS-scoped route silently
// operate with no actor (Fase 3B pre-cutover): an actor set with enterWith()
// inside a helper (requireUser() -> currentUser()) did not survive the caller
// resuming after its await, so later queries ran as "nobody" — RLS returned
// nothing / updated nothing, with no error.
//
// Two layers, both run by `pnpm verify` (and so by CI):
//   1. runtime: withActor() keeps the right actor across awaits/timers and never
//      leaks between concurrent requests;
//   2. static: no enterWith()/setActor() exists in src/, every authenticated route
//      handler does its database work inside withActor(), and the anonymous auth
//      routes run their transactions inside it. The checkers are validated against
//      fixtures of the bug patterns, so they can not pass vacuously.

// ---------------------------------------------------------------- runtime ----

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("withActor: the actor is visible across awaits, timers and helpers, and gone afterwards", async () => {
  assert.equal(currentActorId(), null);
  const seen = await withActor("u1", async () => {
    const a = currentActorId();
    await sleep(5);
    const b = currentActorId();
    const c = await (async () => {
      await null;
      return currentActorId();
    })();
    const d = await Promise.resolve().then(() => currentActorId());
    return [a, b, c, d];
  });
  assert.deepEqual(seen, ["u1", "u1", "u1", "u1"]);
  assert.equal(currentActorId(), null, "the actor must not outlive the callback");
});

test("withActor: concurrent requests never see each other's actor", async () => {
  const run = (id, delay) =>
    withActor(id, async () => {
      const before = currentActorId();
      await sleep(delay);
      const after = currentActorId();
      await Promise.resolve();
      return [before, after, currentActorId()];
    });
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, i) => run(`user-${i}`, (i * 7) % 13)),
  );
  results.forEach((r, i) => assert.deepEqual(r, Array(3).fill(`user-${i}`)));
});

test("withActor: a callee that establishes its own actor does not change its caller's", async () => {
  // The removed setActor() did the opposite: whatever a helper set was lost to
  // (or clobbered) the caller. Here the helper's scope ends with the helper.
  const helper = () => withActor("inner", async () => currentActorId());
  const outcome = await withActor("outer", async () => {
    const before = currentActorId();
    const inner = await helper();
    return [before, inner, currentActorId()];
  });
  assert.deepEqual(outcome, ["outer", "inner", "outer"]);
});

test("withActor(null) means no actor, not the outer one", async () => {
  const seen = await withActor("outer", () => withActor(null, async () => currentActorId()));
  assert.equal(seen, null);
});

// ----------------------------------------------------------------- static ----

const AUTH_CALLS = new Set(["requireUser", "requireMentor", "requirePlatformAdmin", "currentUser"]);
const HANDLERS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
// Modules whose exports read or write the database. Anything imported from them is
// "database work" (except the names below, which are pure or self-scoped).
const DB_MODULES = [/^@\/server\/(db|study|mentor|identity|authorization|audit)$/, /^\.\/(db|study|mentor|identity|authorization|audit)$/];
const NOT_DB_WORK = new Set(["withActor", "isPostgres"]);

const parse = (text, name) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const calleeName = (call) =>
  ts.isIdentifier(call.expression) ? call.expression.text
    : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text
      : null;

function walkNodes(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walkNodes(child, visit));
}

// (a) No enterWith() call and no setActor identifier (call, import or export).
export function auditNoEnterWith(text, name) {
  const violations = [];
  walkNodes(parse(text, name), (node) => {
    if (ts.isCallExpression(node) && calleeName(node) === "enterWith")
      violations.push(`${name}: calls enterWith()`);
    if (ts.isIdentifier(node) && node.text === "setActor")
      violations.push(`${name}: references setActor`);
  });
  return violations;
}

// (b) In each exported route handler, once it has authenticated (requireUser() etc.),
// no database work may happen outside a withActor(...) call's arguments.
// (c) In any handler, every transaction() call must be inside withActor(...).
export function auditRouteHandlers(text, name) {
  const sf = parse(text, name);
  const violations = [];
  const dbNames = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    const specifier = st.moduleSpecifier.text;
    const isDb = DB_MODULES.some((re) => re.test(specifier)) || /@\/server\/http$/.test(specifier);
    if (!isDb) continue;
    for (const el of st.importClause.namedBindings.elements) {
      const local = el.name.text;
      if (NOT_DB_WORK.has(local)) continue;
      if (/@\/server\/http$/.test(specifier) && local !== "limit") continue; // only limit() touches the DB
      dbNames.add(local);
    }
  }
  // local helpers (e.g. requireMentor) that themselves do database work, one level deep
  const localFns = new Map();
  for (const st of sf.statements)
    if (ts.isFunctionDeclaration(st) && st.name && st.body) localFns.set(st.name.text, st);
  const touchesDb = (fnNode) => {
    let found = false;
    walkNodes(fnNode.body, (n) => {
      if (ts.isCallExpression(n) && dbNames.has(calleeName(n))) found = true;
    });
    return found;
  };
  const dbLike = new Set(dbNames);
  for (const [fname, fn] of localFns) if (!HANDLERS.has(fname) && touchesDb(fn)) dbLike.add(fname);

  const unsafeCalls = (statement, names) => {
    const found = [];
    const visit = (node, safe) => {
      if (ts.isCallExpression(node)) {
        const callee = calleeName(node);
        if (!safe && names.has(callee)) found.push(callee);
        if (callee === "withActor") {
          ts.forEachChild(node, (c) => visit(c, true));
          return;
        }
      }
      ts.forEachChild(node, (c) => visit(c, safe));
    };
    visit(statement, false);
    return found;
  };

  for (const st of sf.statements) {
    if (!ts.isFunctionDeclaration(st) || !st.name || !HANDLERS.has(st.name.text) || !st.body) continue;
    const handler = `${name} ${st.name.text}()`;
    // (c)
    for (const bad of unsafeCalls(st.body, new Set(["transaction"]))) violations.push(`${handler}: ${bad}() outside withActor()`);
    // (b)
    let authCall = null;
    walkNodes(st.body, (n) => {
      if (!authCall && ts.isCallExpression(n) && AUTH_CALLS.has(calleeName(n))) authCall = n;
    });
    if (!authCall) continue;
    let statement = authCall;
    while (statement.parent && !ts.isBlock(statement.parent)) statement = statement.parent;
    const block = statement.parent;
    const after = block.statements.slice(block.statements.indexOf(statement) + 1);
    for (const s of after)
      for (const bad of unsafeCalls(s, dbLike)) violations.push(`${handler}: ${bad}() runs after authentication but outside withActor()`);
  }
  return violations;
}

const srcFiles = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) srcFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
};
const routeFiles = srcFiles("src/app/api").filter((f) => /route\.ts$/.test(f));

test("src/ has no enterWith() and no setActor", () => {
  const all = srcFiles("src");
  assert.ok(all.length > 30, "should scan the whole source tree");
  const violations = all.flatMap((f) => auditNoEnterWith(readFileSync(f, "utf8"), f));
  assert.deepEqual(violations, []);
});

test("every route handler does its database work inside withActor() after authenticating", () => {
  assert.ok(routeFiles.length >= 6, `expected the API routes, found ${routeFiles.length}`);
  const violations = routeFiles.flatMap((f) => auditRouteHandlers(readFileSync(f, "utf8"), f));
  assert.deepEqual(violations, []);
  // and the audit really looked at the authenticated handlers:
  const authenticated = routeFiles.filter((f) => /requireUser|requireMentor|requirePlatformAdmin/.test(readFileSync(f, "utf8")));
  assert.ok(authenticated.length >= 4, "study, mentor, admin and auth routes authenticate");
});

test("the route audit catches the bug patterns and accepts the correct ones (fixtures)", () => {
  const head = `import { requireUser } from "@/server/auth";
import { db, transaction, withActor } from "@/server/db";
import { state } from "@/server/study";
import { limit } from "@/server/http";
import { roster } from "@/server/mentor";
`;
  const ok = (body) => auditRouteHandlers(`${head}export async function POST(request: Request) {\n${body}\n}`, "fixture.ts");
  // correct pattern
  assert.deepEqual(ok(`try { const user = await requireUser(); return await withActor(user.id, async () => { await limit("k", 1); return state(user); }); } catch (e) { throw e; }`), []);
  // the original bug: db work right after requireUser(), no withActor
  assert.equal(ok(`try { const user = await requireUser(); return await state(user); } catch (e) { throw e; }`).length, 1);
  assert.equal(ok(`try { const user = await requireUser(); await db().prepare("SELECT 1").get(); } catch (e) { throw e; }`).length, 1);
  assert.equal(ok(`try { const user = await requireUser(); await limit("k", 1); return await withActor(user.id, () => state(user)); } catch (e) { throw e; }`).length, 1);
  assert.equal(ok(`try { const user = await requireUser(); return roster(user.id); } catch (e) { throw e; }`).length, 1);
  // a local helper that itself does database work (like requireMentor) is database work too
  const viaHelper = auditRouteHandlers(
    `${head}async function requireMentor(u: any) { return roster(u.id); }\nexport async function GET() { try { const u = await requireUser(); const m = await requireMentor(u); return m; } catch (e) { throw e; } }`,
    "fixture.ts",
  );
  assert.equal(viaHelper.length, 1);
  // a transaction() outside withActor() is flagged even without authentication
  assert.equal(ok(`await transaction(async () => {});`).length, 1);
  assert.deepEqual(ok(`await withActor("x", () => transaction(async () => {}));`), []);
});

test("the enterWith/setActor audit catches its patterns (fixtures)", () => {
  assert.deepEqual(auditNoEnterWith("export const x = 1;", "f.ts"), []);
  assert.equal(auditNoEnterWith("import { setActor } from './db'; setActor('u');", "f.ts").length >= 1, true);
  assert.equal(auditNoEnterWith("store.enterWith({ userId: 'u' });", "f.ts").length, 1);
  // a mention in a comment is not code
  assert.deepEqual(auditNoEnterWith("// setActor() and enterWith() were removed\nexport const y = 2;", "f.ts"), []);
});

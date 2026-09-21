import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { postgresSql } from "../src/server/postgres-config.mjs";
import { authBuckets, clientIp, recoveryEmailBuckets, recoveryIpBucket } from "../src/server/rate-limit-policy.ts";

// ------------------------------------------------------------- client IP ----

const headers = (obj) => ({ get: (name) => obj[name.toLowerCase()] ?? null });

test("clientIp: headers are never trusted outside Vercel (a client could choose them)", () => {
  assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" }), false), null);
});

test("clientIp: on Vercel it reads the platform-set headers, first hop only, and rejects junk", () => {
  assert.equal(clientIp(headers({ "x-vercel-forwarded-for": "203.0.113.9" }), true), "203.0.113.9");
  assert.equal(clientIp(headers({ "x-real-ip": "203.0.113.10" }), true), "203.0.113.10");
  assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.11, 10.0.0.1, 10.0.0.2" }), true), "203.0.113.11");
  assert.equal(clientIp(headers({ "x-forwarded-for": "2001:DB8::1" }), true), "2001:db8::1");
  assert.equal(clientIp(headers({}), true), null);
  assert.equal(clientIp(headers({ "x-real-ip": "not an ip; DROP TABLE" }), true), null);
  assert.equal(clientIp(headers({ "x-real-ip": "1".repeat(80) }), true), null);
});

test("buckets: keyed per address and per account+address, no shared bucket when the IP is known", () => {
  const withIp = authBuckets("ana@example.test", "203.0.113.9");
  assert.deepEqual(withIp.map((b) => b.key), ["auth-ip:203.0.113.9", "auth:ana@example.test:203.0.113.9", "auth:ana@example.test"]);
  assert.ok(!withIp.some((b) => b.key === "auth-global"), "no bucket shared by everybody");
  const noIp = authBuckets("ana@example.test", null);
  assert.equal(noIp[0].key, "auth-global");
  assert.ok(noIp[0].max >= 1000, "the fallback shared ceiling must be generous");
  // an address is not part of another address's buckets
  const other = authBuckets("ana@example.test", "203.0.113.77");
  assert.equal(other[1].key === withIp[1].key, false);
  assert.equal(recoveryIpBucket("203.0.113.9").key, "recovery-ip:203.0.113.9");
  assert.equal(recoveryIpBucket(null).key, "recovery-global");
  assert.equal(recoveryEmailBuckets("ana@example.test", "203.0.113.9")[0].max, 3, "recovery e-mails stay tightly limited per address");
});

// ------------------------------ the real limit() SQL, run against Postgres ----

// The statement is taken from src/server/http.ts itself, not copied here.
function limiterSql() {
  const source = readFileSync("src/server/http.ts", "utf8");
  const sf = ts.createSourceFile("http.ts", source, ts.ScriptTarget.Latest, true);
  let sql = null;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "prepare") {
      const arg = node.arguments[0];
      if (arg && (ts.isNoSubstitutionTemplateLiteral(arg) || ts.isStringLiteral(arg)) && /INSERT INTO rate_limits/.test(arg.text)) sql = arg.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.ok(sql, "could not find the rate_limits upsert in src/server/http.ts");
  return sql;
}

async function limiter() {
  const db = new PGlite();
  for (const file of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const sql = postgresSql(limiterSql());
  let now = 1_000_000;
  const hit = async (key, duration = 15 * 60_000) => {
    const digest = createHash("sha256").update(key).digest("hex");
    const r = await db.query(sql, [digest, now + duration, now, now, now + duration]);
    return Number(r.rows[0].hits);
  };
  // what a route does: run the buckets in order, stop at the first one over its max
  const attempt = async (buckets) => {
    for (const b of buckets) if ((await hit(b.key, b.window)) > b.max) return "blocked";
    return "allowed";
  };
  return { db, hit, attempt, advance: (ms) => (now += ms), expire: async () => db.exec("UPDATE aristo.rate_limits SET until = 0") };
}

test("limit(): counts hits within a window and restarts at 1 once the window has expired", async () => {
  const { db, hit, advance } = await limiter();
  try {
    assert.deepEqual([await hit("k"), await hit("k"), await hit("k")], [1, 2, 3]);
    assert.equal(await hit("another-key"), 1);
    advance(15 * 60_000 + 1);
    assert.equal(await hit("k"), 1, "an expired window starts over without any sweep");
    assert.equal(await hit("k"), 2);
  } finally {
    await db.close();
  }
});

test("new policy: a script hammering one account locks out only itself, not the owner or anyone else", async () => {
  const { db, attempt } = await limiter();
  try {
    const attacker = "198.51.100.66";
    const results = [];
    for (let i = 0; i < 300; i++) results.push(await attempt(authBuckets("ian@example.test", attacker)));
    assert.equal(results.filter((r) => r === "allowed").length, 10, "the attacker gets its own 10 tries and no more");
    // the owner, on his own address, is unaffected
    assert.equal(await attempt(authBuckets("ian@example.test", "203.0.113.20")), "allowed");
    // unrelated people are unaffected
    for (const [email, ip] of [["ana@example.test", "203.0.113.21"], ["joao@example.test", "203.0.113.22"], ["arthur@example.test", "203.0.113.23"]])
      assert.equal(await attempt(authBuckets(email, ip)), "allowed");
    // sign-ups and logins for brand-new addresses still work
    assert.equal(await attempt(authBuckets("novo@example.test", "192.0.2.5")), "allowed");
  } finally {
    await db.close();
  }
});

test("new policy: one address spraying many accounts is stopped by the per-address bucket", async () => {
  const { db, attempt } = await limiter();
  try {
    const attacker = "198.51.100.66";
    let allowed = 0;
    for (let i = 0; i < 300; i++) if ((await attempt(authBuckets(`victim${i}@example.test`, attacker))) === "allowed") allowed++;
    assert.equal(allowed, 40);
    assert.equal(await attempt(authBuckets("ana@example.test", "203.0.113.21")), "allowed");
  } finally {
    await db.close();
  }
});

test("new policy: many addresses guessing one account are capped by the per-account bucket", async () => {
  const { db, attempt } = await limiter();
  try {
    let allowed = 0;
    for (let i = 0; i < 200; i++) if ((await attempt(authBuckets("ian@example.test", `198.51.100.${i % 250}`))) === "allowed") allowed++;
    assert.equal(allowed, 60, "a botnet costs many addresses to reach the cap, and the cap is 60 per 15 minutes");
  } finally {
    await db.close();
  }
});

test("new policy does not get in the way of the real users (six people, a few wrong passwords each)", async () => {
  const { db, attempt } = await limiter();
  try {
    const sharedAddress = "203.0.113.5"; // e.g. everybody on the same Wi-Fi
    const people = ["ian", "joao", "arthur", "icaro", "jose", "daniel"].map((n) => `${n}@example.test`);
    for (let round = 0; round < 4; round++)
      for (const email of people) assert.equal(await attempt(authBuckets(email, sharedAddress)), "allowed", `${email} round ${round}`);
  } finally {
    await db.close();
  }
});

test("the OLD policy (one bucket shared by everybody) is what the attack above defeated — regression demonstration", async () => {
  const { db, attempt } = await limiter();
  try {
    const oldPlan = (email) => [{ key: "auth-global", max: 100, window: 15 * 60_000 }, { key: `auth:${email}`, max: 10, window: 15 * 60_000 }];
    for (let i = 0; i < 100; i++) await attempt(oldPlan(`spam${i}@example.test`));
    // 100 requests from one script and now nobody can log in
    assert.equal(await attempt(oldPlan("ana@example.test")), "blocked");
    assert.equal(await attempt(oldPlan("ian@example.test")), "blocked");
  } finally {
    await db.close();
  }
});
